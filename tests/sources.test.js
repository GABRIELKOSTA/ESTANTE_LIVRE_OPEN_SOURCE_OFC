import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertBookFile, directFile, fileFormat, httpUrl, decodeLabel } from '../src/lib/download-links.js';
import { SOURCES, sourceById } from '../src/lib/sources.js';

test('todos os sites marcados como extensão apontam para uma implementação do mesmo tipo', () => {
  const data = JSON.parse(fs.readFileSync(new URL('../src/data/sites.json', import.meta.url), 'utf8'));
  assert.equal(new Set(SOURCES.map((s) => s.id)).size, SOURCES.length);
  for (const site of data.sites.filter((s) => s.extensao)) {
    const source = sourceById(site.extensao);
    assert.ok(source, site.nome);
    assert.equal(source.kind, site.tipo, site.nome);
    assert.equal(typeof source.search, 'function');
  }
  for (const id of ['elivros', 'dlivros', 'baixelivros', 'soquadrinhos', 'multiversohq', 'tudohqemanga', 'archive-hq', 'hqnow']) {
    assert.ok(data.sites.some((s) => s.extensao === id), id);
  }
});

test('reconhece formatos de livros e HQ sem confundir página intermediária com arquivo', () => {
  for (const format of ['epub', 'pdf', 'cbr', 'cbz']) {
    assert.deepEqual(directFile(`/files/Titulo.${format.toUpperCase()}?token=1#download`, 'https://site.test/'), {
      url: `https://site.test/files/Titulo.${format.toUpperCase()}?token=1#download`, format,
    });
  }
  assert.equal(directFile('https://asdocs.net/2Odoe'), null);
  assert.equal(directFile('https://site.test/download?name=livro.pdf'), null);
  assert.equal(fileFormat('https://site.test/index.html?book=x.cbz'), '');
  assert.equal(fileFormat('https://site.test/HQ%2ECBZ'), 'cbz');
  assert.equal(fileFormat('https://site.test/x.mobi'), '');
});

test('extrai o PDF do redirect de Baixe Livros', () => {
  const pdf = 'https://files.test/dom-casmurro.pdf';
  assert.deepEqual(directFile('https://site.test/download-gratuito?dom-casmurro.pdf=&pdf=' + encodeURIComponent(pdf)), { url: pdf, format: 'pdf' });
});

test('ignora URLs não HTTP e tolera nomes mal codificados', () => {
  for (const value of ['', '#', 'javascript:alert(1)', 'data:text/html,test', 'file:///C:/x.pdf']) {
    if (value !== '#') assert.equal(httpUrl(value), '');
  }
  assert.equal(decodeLabel('%ZZ.pdf'), '%ZZ.pdf');
  assert.equal(directFile('javascript:alert(1)'), null);
});

test('recusa HTML e respostas inválidas antes de importar para a estante', async () => {
  for (const value of ['<!DOCTYPE html><html>Redirect</html>', '  <html>Login</html>', 'Forbidden']) {
    await assert.rejects(assertBookFile(new Blob([value])));
  }
  // Alguns hospedadores usam Content-Type errado; a assinatura do arquivo prevalece.
  await assertBookFile(new Blob(['PK\x03\x04'], { type: 'text/html' }));
  for (const value of ['%PDF-1.7', 'PK\x03\x04', 'Rar!\x1a\x07']) await assertBookFile(new Blob([value]));
});

test('busca de HQs do Archive preserva idioma, paginação e downloads públicos', async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(new URL(url));
    return new Response(JSON.stringify(url.includes('/metadata/') ? {
      metadata: { title: 'HQ pública', creator: 'Autor' },
      files: [
        { name: 'privado.cbr', private: true },
        { name: 'livro.epub' }, { name: 'livro2.epub' }, { name: 'livro3.epub' }, { name: 'livro4.epub' },
        { name: 'ocr_text.pdf' }, { name: 'HQ 01.cbz', size: '123' }, { name: 'HQ 02.cbr' }, { name: 'HQ.pdf' },
      ],
    } : { response: { docs: [{ identifier: 'hq-1', title: 'Uma HQ', language: 'por' }], numFound: 60 } }));
  };
  try {
    const source = sourceById('archive-hq');
    const result = await source.search('teste', 2, 'pt');
    assert.equal(result.next, 3);
    assert.equal(result.items[0].lang, 'pt');
    assert.equal(requests[0].searchParams.get('page'), '2');
    assert.match(requests[0].searchParams.get('q'), /language:\(por/);
    assert.match(requests[0].searchParams.get('q'), /-access-restricted-item:true/);
    const resolved = await source.resolve(result.items[0]);
    assert.deepEqual(resolved.files.map((f) => f.format), ['cbz', 'cbr', 'pdf']);
    assert.match(resolved.files[0].url, /HQ%2001.cbz$/);
    assert.equal(resolved.files[0].size, 123);
  } finally { globalThis.fetch = original; }
});
