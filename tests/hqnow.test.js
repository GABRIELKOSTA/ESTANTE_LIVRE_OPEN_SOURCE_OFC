import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { createHQNowSource } from '../src/lib/hqnow.js';
import { downloadKey, assertBookFile } from '../src/lib/download-links.js';
import { postJson } from '../src/lib/net.js';
import { openComic } from '../src/lib/comic.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2XQAAAAASUVORK5CYII=', 'base64');
const fixture = {
  id: 7, name: 'Herói & Companhia', publisherName: 'Editora de teste', hqCover: 'https://images.test/cover.jpg', synopsis: 'Uma aventura.',
  capitulos: [{ id: 703, number: '10', name: 'Fim' }, { id: 702, number: '2', name: 'A & B' }, { id: 701, number: '1', name: 'Início' }, { id: 701, number: '1', name: 'Duplicado' }],
};
function setup(options = {}) {
  const calls = [];
  const source = createHQNowSource({
    interval: 0,
    request: async (url, body) => {
      calls.push({ url, ...body });
      if (body.operationName === 'EstanteHQSearch') return { data: { getHqsByName: [fixture] } };
      if (body.operationName === 'EstanteHQPopular') return { data: { getHqsByFilters: [fixture] } };
      if (body.operationName === 'EstanteHQDetails') return { data: { getHqsById: [fixture] } };
      if (body.operationName === 'EstanteHQChapter') return { data: { getChapterById: { name: 'Início', number: '1', pictures: [{ pictureUrl: 'https://images.test/02.png' }, { pictureUrl: 'https://images.test/01.png' }] } } };
      throw new Error('Operação inesperada');
    },
    download: async () => new Blob([png], { type: 'image/png' }),
    ...options,
  });
  return { source, calls };
}
async function first(source) { return (await source.search('herói')).items[0]; }

test('HQ Now usa variáveis na busca e mapeia a HQ para a extensão em português', async () => {
  const { source, calls } = setup();
  const result = await source.search('  herói " teste  ');
  assert.equal(result.items[0].hqId, 7);
  assert.equal(result.items[0].lang, 'pt');
  assert.equal(result.items[0].author, fixture.publisherName);
  assert.equal(result.items[0].url, 'https://www.hq-now.com/hq/7/heroi-companhia');
  assert.equal(result.next, null);
  assert.equal(calls[0].url, 'https://admin.hq-now.com/graphql');
  assert.deepEqual(calls[0].variables, { name: 'herói " teste' });
  assert.ok(!calls[0].query.includes('herói'));
});

test('catálogo popular e pesquisa paginam localmente sem repetir a consulta', async () => {
  let requests = 0;
  const { source } = setup({ request: async (_url, body) => {
    requests++;
    assert.deepEqual(body.variables, { limit: 300, orderByViews: true, loadCovers: true });
    return { data: { getHqsByFilters: Array.from({ length: 50 }, (_, n) => ({ id: n + 1, name: `HQ ${n + 1}` })) } };
  } });
  const a = await source.search('', 1), b = await source.search('', 2), c = await source.search('', 3);
  assert.equal(a.items.length, 24); assert.equal(b.items.length, 24); assert.equal(c.items.length, 2);
  assert.equal(a.next, 2); assert.equal(b.next, 3); assert.equal(c.next, null);
  assert.equal(new Set([...a.items, ...b.items, ...c.items].map((it) => it.key)).size, 50);
  assert.equal(requests, 1);
});

test('detalhes deduplicam e ordenam capítulos e geram nomes e chaves diferentes', async () => {
  const { source, calls } = setup();
  const item = await first(source);
  const info = await source.resolve(item);
  assert.ok(info.chapters);
  assert.equal(info.description, fixture.synopsis);
  assert.equal(info.cover, fixture.hqCover);
  assert.deepEqual(info.files.map((f) => f.label), ['#1 · Início', '#2 · A & B', '#10 · Fim']);
  assert.equal(info.files[1].title, 'Herói & Companhia #2 · A & B');
  assert.equal(info.files[0].sourceUrl, 'https://www.hq-now.com/hq-reader/7/heroi-companhia/chapter/701/page/1');
  assert.equal(new Set(info.files.map((f) => downloadKey(f, item, source))).size, 3);
  assert.deepEqual(calls[1].variables, { id: 7 });
});

test('CBZ contém todas as imagens na ordem da API, metadados e progresso completo', async () => {
  const { source, calls } = setup({ download: async (url) => {
    // Entrega fora de ordem para testar a numeração das páginas no ZIP.
    if (url.endsWith('02.png')) await new Promise((r) => setTimeout(r, 15));
    return new Blob([png, url.endsWith('02.png') ? new Uint8Array([2]) : new Uint8Array([1])]);
  } });
  const info = await source.resolve(await first(source));
  const progress = [];
  const blob = await info.files[0].build((p) => progress.push(p));
  await assertBookFile(blob);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  assert.deepEqual(Object.keys(zip.files).sort(), ['000001.png', '000002.png', 'ComicInfo.xml']);
  assert.equal((await zip.file('000001.png').async('uint8array')).at(-1), 2);
  assert.equal((await zip.file('000002.png').async('uint8array')).at(-1), 1);
  const xml = await zip.file('ComicInfo.xml').async('string');
  assert.match(xml, /<Series>Herói &amp; Companhia<\/Series>/);
  assert.match(xml, /<Number>1<\/Number>/);
  assert.match(xml, /<PageCount>2<\/PageCount>/);
  assert.equal(progress[0], 0); assert.equal(progress.at(-1), 1);
  assert.ok(progress.every((p, i) => i === 0 || p >= progress[i - 1]));
  assert.deepEqual(calls.at(-1).variables, { chapterId: 701 });
});

test('limita downloads paralelos e rejeita páginas HTML sem salvar capítulo parcial', async () => {
  let active = 0, maximum = 0, downloads = 0;
  const { source } = setup({ download: async () => {
    downloads++; maximum = Math.max(maximum, ++active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return new Blob(['<!doctype html>Erro'], { type: 'text/html' });
  } });
  const info = await source.resolve(await first(source));
  await assert.rejects(info.files[0].build(), /falha na página \d.*imagem válida/);
  assert.ok(maximum <= 3);
  assert.equal(active, 0);
  assert.ok(downloads > 0);
});

test('baixa todas as páginas com até três transferências simultâneas', async () => {
  let active = 0, maximum = 0;
  const { source } = setup({
    request: async (_url, body) => body.operationName === 'EstanteHQDetails'
      ? { data: { getHqsById: [fixture] } }
      : { data: { getChapterById: { pictures: Array.from({ length: 7 }, (_, i) => ({ pictureUrl: `https://images.test/${i}.png` })) } } },
    download: async () => {
      maximum = Math.max(maximum, ++active);
      await new Promise((r) => setTimeout(r, 2));
      active--; return new Blob([png]);
    },
  });
  const info = await source.resolve({ hqId: 7 });
  const zip = await JSZip.loadAsync(await (await info.files[0].build()).arrayBuffer());
  assert.equal(Object.keys(zip.files).filter((n) => n.endsWith('.png')).length, 7);
  assert.equal(maximum, 3);
});

test('o CBZ gerado abre no leitor de HQ e fornece páginas sem acessar a rede', async () => {
  const { source } = setup();
  const info = await source.resolve(await first(source));
  const blob = await info.files[0].build();
  // FileReader é uma API do navegador usada pelo JSZip ao receber Blob.
  const originalReader = globalThis.FileReader;
  const originalFetch = globalThis.fetch;
  globalThis.FileReader = class {
    readAsArrayBuffer(value) {
      value.arrayBuffer().then((result) => { this.result = result; this.onload({ target: this }); })
        .catch((error) => { this.error = error; this.onerror({ target: this }); });
    }
  };
  globalThis.fetch = () => { throw new Error('Leitura offline não deve acessar a rede'); };
  let comic;
  try {
    comic = await openComic(blob);
    assert.equal(comic.count, 2);
    assert.equal(comic.kind, 'zip');
    assert.deepEqual(Buffer.from(await (await comic.pageBlob(0)).arrayBuffer()), png);
    assert.match(await comic.pageUrl(1), /^blob:/);
  } finally {
    comic?.destroy();
    globalThis.fetch = originalFetch;
    if (originalReader === undefined) delete globalThis.FileReader;
    else globalThis.FileReader = originalReader;
  }
});

test('páginas inválidas e capítulo vazio resultam em mensagens claras', async () => {
  for (const pictures of [[], [{ pictureUrl: 'javascript:alert(1)' }], [{ pictureUrl: '' }]]) {
    const { source } = setup({ request: async (_url, body) => body.operationName === 'EstanteHQDetails'
      ? { data: { getHqsById: [fixture] } } : { data: { getChapterById: { pictures } } } });
    const info = await source.resolve({ hqId: 7, title: fixture.name });
    await assert.rejects(info.files[0].build(), /sem endereço válido|não tem páginas/);
  }
});

test('erro GraphQL não vira lista vazia e uma nova tentativa funciona', async () => {
  let attempts = 0;
  const { source } = setup({ request: async () => ++attempts === 1
    ? { errors: [{ message: 'Servidor indisponível' }] }
    : { data: { getHqsByName: [fixture] } } });
  await assert.rejects(source.search('teste'), /Servidor indisponível/);
  assert.equal((await source.search('teste')).items.length, 1);
});

test('respostas malformadas e identificadores inválidos não passam silenciosamente', async () => {
  for (const data of [{}, { data: { getHqsByName: {} } }]) {
    const { source } = setup({ request: async () => data });
    await assert.rejects(source.search('teste'), /resposta inesperada|lista de resultados inválida/);
  }
  const { source } = setup();
  await assert.rejects(source.resolve({ hqId: '7 OR 1=1' }), /identificador inválido/);
});

test('chamadas concorrentes respeitam o intervalo da API', async () => {
  let time = 10000;
  const timestamps = [];
  const { source } = setup({ interval: 2000, now: () => time, wait: async (ms) => { time += ms; }, request: async () => {
    timestamps.push(time); return { data: { getHqsByName: [] } };
  } });
  await Promise.all([source.search('a'), source.search('b'), source.search('c')]);
  assert.deepEqual(timestamps, [10000, 12000, 14000]);
});

test('rede envia GraphQL por POST JSON e mantém erros HTTP', async () => {
  const original = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, options) => {
    sent = { url, ...options }; return new Response(JSON.stringify({ data: { ok: true } }));
  };
  try {
    assert.deepEqual(await postJson('https://api.test/graphql', { query: '{ test }', variables: { name: 'A & B' } }), { data: { ok: true } });
    assert.equal(sent.method, 'POST');
    assert.equal(sent.headers['Content-Type'], 'application/json');
    assert.equal(JSON.parse(sent.body).variables.name, 'A & B');
    globalThis.fetch = async () => new Response('', { status: 503 });
    await assert.rejects(postJson('https://api.test/graphql', {}), /HTTP 503/);
  } finally { globalThis.fetch = original; }
});
