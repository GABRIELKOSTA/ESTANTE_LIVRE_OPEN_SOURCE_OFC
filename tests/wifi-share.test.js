import test from 'node:test';
import assert from 'node:assert/strict';
import { createWifiSender, createWifiReceiver, parseWifiLink } from '../src/lib/wifi-share.js';
import { qrMatrix } from '../src/lib/qr.js';

const token = '0123456789abcdef0123456789abcdef';
const url = `http://192.168.1.25:42421/s/${token}/file.pdf`;
const link = (target = url) => `estantelivre://receive?url=${encodeURIComponent(target)}&title=Livro%20teste&author=Autora`;

test('recebimento aceita somente arquivos de sessões na rede privada', () => {
  assert.deepEqual(parseWifiLink(link()), { url, format: 'pdf', title: 'Livro teste', author: 'Autora' });
  for (const target of [url.replace('192.168.1.25', '8.8.8.8'), url.replace('192.168.1.25', '127.0.0.1'), url.replace('192.168.1.25', 'example.com'), url.replace(token, '..'), url + '?url=https://example.com', url.replace('http:', 'file:'), url.replace('/file.pdf', '/file.html'), url.replace('192.168.1.25', 'user:pass@192.168.1.25')]) assert.throws(() => parseWifiLink(link(target)));
  assert.throws(() => parseWifiLink('https://example.com/receive?url=' + encodeURIComponent(url)));
});

test('envio prepara em partes e conserva todos os bytes, sem publicar arquivo parcial', async () => {
  const bytes = Uint8Array.from({ length: 500123 }, (_, i) => i % 256);
  const parts = [], progress = [];
  let finished = false, stopped = false;
  const sender = createWifiSender({ native: () => true, plugin: {
    begin: async meta => { assert.equal(meta.size, bytes.length); return { sessionId: token }; },
    append: async part => { assert.equal(part.sessionId, token); assert.equal(part.offset, parts.reduce((n, b) => n + b.length, 0)); parts.push(Buffer.from(part.data, 'base64')); assert.equal(finished, false); },
    finish: async () => { finished = true; return { url }; },
    stop: async () => { stopped = true; },
  } });
  assert.equal((await sender.start({ title: 'Teste', format: 'pdf' }, new Blob([bytes]), p => progress.push(p))).url, url);
  assert.deepEqual(Buffer.concat(parts), Buffer.from(bytes));
  assert.equal(parts.length, 3); assert.equal(progress.at(-1), 1);
  await sender.stop(); assert.equal(stopped, true);
});

test('fechar a tela durante a preparação limpa a sessão e não publica QR', async () => {
  let beginReady, stopped = 0, finished = 0;
  const sender = createWifiSender({ native: () => true, plugin: {
    begin: () => new Promise(resolve => { beginReady = resolve; }),
    finish: async () => { finished++; }, stop: async () => { stopped++; },
  } });
  const pending = sender.start({ title: 'Teste', format: 'pdf' }, new Blob(['%PDF']));
  await sender.stop(); beginReady({ sessionId: token });
  await assert.rejects(pending, /encerrado/);
  assert.equal(finished, 0); assert.equal(stopped, 1);
});

test('falha ao copiar limpa o temporário e não inicia o servidor', async () => {
  let stopped = false;
  const sender = createWifiSender({ native: () => true, plugin: {
    begin: async () => ({ sessionId: token }), append: async () => { throw Error('Sem espaço'); },
    finish: async () => assert.fail('Não pode publicar arquivo incompleto'), stop: async () => { stopped = true; },
  } });
  await assert.rejects(sender.start({ format: 'pdf' }, new Blob(['%PDF'])), /Sem espaço/);
  assert.equal(stopped, true);
});

test('recebimento importa bytes e metadados direto na estante e deduplica o mesmo QR', async () => {
  let requests = 0, imports = 0;
  const receive = createWifiReceiver({
    request: async options => { requests++; assert.equal(options.url, url); assert.equal(options.disableRedirects, true); return { status: 200, data: Buffer.from('%PDF-1.7\nfixture').toString('base64') }; },
    importBlob: async (blob, meta) => { imports++; assert.match(await blob.text(), /^%PDF/); assert.equal(meta.title, 'Livro teste'); assert.equal(meta.author, 'Autora'); assert.equal(meta.name, 'Livro teste.pdf'); return { id: 'received' }; },
  });
  const results = await Promise.all([receive(link()), receive(link())]);
  assert.equal(results[0].id, 'received'); assert.equal(results[1].id, 'received');
  assert.equal(requests, 1); assert.equal(imports, 1);
});

test('recusa HTML, permite repetir falha e bloqueia redirects do compartilhamento', async () => {
  let bad = true;
  const receive = createWifiReceiver({ request: async () => ({ status: 200, data: Buffer.from(bad ? '<html>expired</html>' : '%PDF-1.7').toString('base64') }), importBlob: async () => 'ok' });
  await assert.rejects(receive(link()), /página em vez/); bad = false;
  assert.equal(await receive(link()), 'ok');
  let requests = 0;
  const redirect = createWifiReceiver({ request: async () => { requests++; return { status: 302, headers: { Location: 'https://example.com/book.pdf' } }; }, importBlob: () => assert.fail() });
  await assert.rejects(redirect(link()), /mudou de endereço/);
  assert.equal(requests, 1);
});

test('QR suporta o maior endereço de compartilhamento e recusa overflow', () => {
  const matrix = qrMatrix(`http://192.168.255.255:65535/s/${token}`);
  assert.equal(matrix.length, 33); assert.ok(matrix.every(row => row.length === 33));
  assert.throws(() => qrMatrix('a'.repeat(79)), /longo demais/);
  assert.throws(() => qrMatrix('á'.repeat(40)), /longo demais/);
});
