import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { DOMParser } from '@xmldom/xmldom';
import { createBookDownloader, downloadTargets } from '../src/lib/download.js';
import { nativeBlob, nativeResource } from '../src/lib/net.js';
import { createCoverCache, validateImage } from '../src/lib/images.js';
import { searchSources, withDeadline } from '../src/lib/source-search.js';
import { loadImage, createCanvas } from '@napi-rs/canvas';

const parse = (s) => new DOMParser().parseFromString(s, 'text/html');

test('resolve redirects HTTP e uma página HTML até o PDF usando a rede local', async () => {
  const visited = [];
  const server = http.createServer((req, res) => {
    visited.push(req.url);
    if (req.url === '/start') { res.writeHead(302, { Location: '/stage' }); return res.end(); }
    if (req.url === '/stage') { res.setHeader('Content-Type', 'text/html'); return res.end('<html><body><a id="downloadButton" href="/file">Baixar agora</a></body></html>'); }
    res.setHeader('Content-Type', 'application/pdf'); res.end('%PDF-1.7\nfixture');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const download = createBookDownloader({ parse });
    const blob = await download(`http://127.0.0.1:${server.address().port}/start`);
    assert.match(await blob.text(), /^%PDF/);
    assert.deepEqual(visited, ['/start', '/stage', '/file']);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('interpreta arquivos em parâmetros, links de download e meta refresh sem executar scripts', () => {
  const doc = parse('<html><head><meta http-equiv="refresh" content="2; url=/release" /></head><body><a href="/download?pdf=https%3A%2F%2Ffiles.test%2Fbook.pdf">Baixar</a><a href="#">Download</a><a href="javascript:alert(1)">Download</a></body></html>');
  assert.deepEqual(downloadTargets(doc, 'https://site.test/book'), [
    { url: 'https://files.test/book.pdf', rank: 0 }, { url: 'https://site.test/release', rank: 1, delay: 2 },
  ]);
});

test('aguarda liberação do servidor e preserva o referer da página intermediária', async () => {
  const waits = [], calls = [], stages = [];
  const download = createBookDownloader({ parse, wait: async (ms) => waits.push(ms), fetchResource: async (url, _p, options) => {
    calls.push({ url, options });
    return { url, blob: new Blob([url.endsWith('/ready') ? '%PDF-1.7' : '<html><head><meta http-equiv="refresh" content="2; url=/ready" /></head><body></body></html>']) };
  } });
  const blob = await download('https://site.test/start', (_p, stage) => stages.push(stage));
  assert.match(await blob.text(), /^%PDF/);
  assert.deepEqual(waits, [1000, 1000]);
  assert.equal(calls[1].options.referer, 'https://site.test/start');
  assert.ok(stages.some((s) => s?.includes('2s')));
});

test('não aceita páginas sem arquivo, CAPTCHA, JSON ou ciclos como download concluído', async () => {
  for (const content of ['<html><body>Nenhum arquivo</body></html>', '<html>cf-chl-challenge</html>', '{"error":"denied"}', '<html><body><a download="" href="/start">Baixar</a></body></html>']) {
    let requests = 0;
    const download = createBookDownloader({ parse, fetchResource: async (url) => { requests++; return { url, blob: new Blob([content]) }; } });
    await assert.rejects(download('https://site.test/start'), /não disponibilizou|exige uma verificação|não retornou/);
    assert.ok(requests <= 6);
  }
});

test('Android decodifica bytes com cabeçalhos/linhas base64 sem confundir JSON com arquivo', async () => {
  const value = Buffer.from('%PDF-1.7\nbytes').toString('base64');
  assert.equal(await nativeBlob(value.slice(0, 4) + '\n' + value.slice(4), 'application/pdf').text(), '%PDF-1.7\nbytes');
  assert.equal(await nativeBlob('data:application/pdf;base64,' + value, 'application/pdf').text(), '%PDF-1.7\nbytes');
  assert.throws(() => nativeBlob({ error: 'login' }, 'application/json'), /dados em vez/);
  assert.throws(() => nativeBlob('<html>login</html>', 'text/html'), /resposta inválida/);
});

test('transporte nativo segue Location com letras variadas e mantém referer e bytes', async () => {
  const requests = [];
  const request = async (options) => {
    requests.push(options);
    return requests.length === 1
      ? { status: 302, headers: { LOCATION: '/file' }, data: '' }
      : { status: 200, headers: { 'cOnTeNt-TyPe': 'application/pdf' }, data: Buffer.from('%PDF-1.7').toString('base64') };
  };
  const result = await nativeResource('https://site.test/start', undefined, { referer: 'https://catalog.test/book' }, request);
  assert.equal(await result.blob.text(), '%PDF-1.7');
  assert.equal(result.blob.type, 'application/pdf');
  assert.equal(requests[0].headers.Referer, 'https://catalog.test/book');
  assert.equal(requests[1].url, 'https://site.test/file');
  assert.equal(requests[1].headers.Referer, 'https://site.test/start');
  assert.equal(requests[0].responseType, 'arraybuffer');
});

test('transporte nativo recusa ciclos e preserva erro HTTP do servidor', async () => {
  await assert.rejects(nativeResource('https://site.test/start', undefined, {}, async () => ({ status: 302, headers: { Location: '/start' } })), /ciclo/);
  await assert.rejects(nativeResource('https://site.test/start', undefined, {}, async () => ({ status: 403, headers: {}, data: 'denied' })), /HTTP 403/);
});

test('capa usa HTTP com referer, compartilha solicitações e permite repetir após falha', async () => {
  const canvas = createCanvas(2, 2);
  const png = canvas.toBuffer('image/png');
  let calls = 0;
  const cache = createCoverCache({ download: async (_url, _p, options) => {
    calls++;
    assert.equal(options.referer, 'https://site.test/book');
    if (calls === 1) throw new Error('offline');
    return new Blob([png]);
  } });
  await assert.rejects(cache.load('https://images.test/cover', 'https://site.test/book'), /offline/);
  const a = cache.load('https://images.test/cover', 'https://site.test/book');
  const b = cache.load('https://images.test/cover', 'https://site.test/book');
  assert.equal(a, b);
  const image = await loadImage(Buffer.from(await (await a).arrayBuffer()));
  assert.equal(image.width, 2);
  assert.equal(calls, 2);
});

test('decodificação detecta uma imagem inválida apesar de começar com assinatura JPEG', async () => {
  const original = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async (blob) => { const image = await loadImage(Buffer.from(await blob.arrayBuffer())); return { width: image.width, height: image.height, close() {} }; };
  try { await assert.rejects(validateImage(new Blob([new Uint8Array([255, 216, 255, 0, 1])])), /Não foi possível abrir/); }
  finally { if (original) globalThis.createImageBitmap = original; else delete globalThis.createImageBitmap; }
});

test('busca limita concorrência e transforma timeout em resultado que pode ser repetido', async () => {
  let active = 0, maximum = 0;
  const results = [];
  const sources = Array.from({ length: 6 }, (_, i) => ({ id: String(i), search: async () => {
    maximum = Math.max(maximum, ++active);
    await new Promise((r) => setTimeout(r, 2)); active--; return { items: [] };
  } }));
  await searchSources(sources, '', 1, 'all', (s, data) => results.push({ id: s.id, ...data }), { concurrency: 2 });
  assert.equal(maximum, 2); assert.equal(results.length, 6);
  await searchSources([{ id: 'hang', search: () => new Promise(() => {}) }], '', 1, 'all', (_s, data) => results.push(data), { timeout: 5 });
  assert.match(results.at(-1).error.message, /demorou/);
  await assert.rejects(withDeadline(new Promise(() => {}), 5), /demorou/);
});

test('uma busca cancelada não inicia consultas que estavam na fila', async () => {
  let current = true, started = 0;
  const sources = Array.from({ length: 4 }, (_, i) => ({ id: String(i), search: async () => { started++; current = false; return { items: [] }; } }));
  await searchSources(sources, '', 1, 'all', () => assert.fail('Resultado antigo não deve aparecer'), { current: () => current, concurrency: 1 });
  assert.equal(started, 1);
});
