import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { createHostedResolver, supportsHostedDownload } from '../src/lib/hosted-download.js';
import { createBookDownloader, downloadTargets } from '../src/lib/download.js';
import { nativeResource } from '../src/lib/net.js';
import fs from 'node:fs';
import vm from 'node:vm';

const parse = (s) => new DOMParser().parseFromString(s, 'text/html');
const probe = fs.readFileSync(new URL('../public/hosted-download-probe.js', import.meta.url), 'utf8');

function control({ label = 'DOWNLOAD LENTO', tag = 'div', visible = true, disabled = false, premium = false, id = '', href = '', onclick = 'startDownload()', cssDisabled = false, form = null } = {}) {
  const attrs = { href, onclick };
  return {
    tag, id, textContent: label, disabled, clicks: 0,
    getClientRects: () => visible ? [{}] : [],
    getAttribute: (name) => attrs[name] || null,
    setAttribute: (name, value) => { attrs[name] = value; },
    removeAttribute: (name) => { delete attrs[name]; },
    classList: { contains: (name) => name === 'disabled' && cssDisabled },
    closest: (selector) => selector === 'form' ? form : premium ? {} : null,
    click() { this.clicks++; },
  };
}
function runProbe({ nodes = [], clocks = [], captcha = [], responses = [], title = '', href = 'https://asdocs.net/file', body = 'DOWNLOAD LENTO' } = {}) {
  const document = {
    body: { textContent: body },
    title,
    querySelectorAll(selector) {
      if (selector.startsWith('iframe')) return captcha;
      if (selector.startsWith('textarea')) return responses;
      if (selector === '[data-estante-clicked]') return nodes.filter((el) => el.getAttribute('data-estante-clicked'));
      if (selector.startsWith('#countdown')) return clocks;
      return nodes.filter((el) => el.tag !== 'div' || selector.includes('[onclick]'));
    },
  };
  return JSON.parse(vm.runInNewContext(probe, { URL, document, location: { href }, window: { getComputedStyle: () => ({ display: 'block', visibility: 'visible', pointerEvents: 'auto', opacity: '1' }) } }));
}

test('após a espera reconhece o botão final sem repetir o clique', () => {
  for (const label of ['Download', 'BAIXAR', 'Download File', 'Baixar arquivo', 'Download (2 MB)']) {
    const button = control({ label, tag: 'button' });
    assert.equal(runProbe({ nodes: [button], body: '' }).kind, 'clicked');
    assert.equal(runProbe({ nodes: [button], body: '' }).kind, 'missing');
    assert.equal(button.clicks, 1);
  }
});

test('link liberado para CDN é retornado sem depender de navegação ou nova janela', () => {
  const url = 'https://download.example.test/signed/file?token=fixture';
  const button = control({ label: 'Download', tag: 'a', href: url, onclick: '' });
  const result = runProbe({ nodes: [button], body: '' });
  assert.equal(result.kind, 'ready');
  assert.equal(result.url, url);
  assert.equal(button.clicks, 0);
});

test('arquivo relativo liberado é resolvido com a página atual', () => {
  const button = control({ label: 'Baixar', tag: 'a', href: '/files/book.pdf', onclick: '' });
  assert.equal(runProbe({ nodes: [button] }).url, 'https://asdocs.net/files/book.pdf');
});

test('link com script do hospedador mantém execução normal e cadastro continua excluído', () => {
  const button = control({ label: 'Download', tag: 'a', href: '/book.pdf' });
  assert.equal(runProbe({ nodes: [button] }).kind, 'clicked');
  const register = control({ label: 'Download', tag: 'a', href: '/register', onclick: '' });
  assert.notEqual(runProbe({ nodes: [register] }).kind, 'ready');
  assert.equal(register.clicks, 0);
});

test('contador zerado não mantém espera indefinida', () => {
  assert.equal(runProbe({ clocks: [control({ label: '0' })], body: '' }).kind, 'missing');
});

test('controle gratuito em div executa o fluxo uma vez sem repetir o clique', () => {
  const button = control();
  assert.equal(runProbe({ nodes: [button] }).kind, 'clicked');
  assert.equal(runProbe({ nodes: [button] }).kind, 'waiting');
  assert.equal(button.clicks, 1);
});

test('controles ocultos, desabilitados, premium e cadastro não são acionados', () => {
  for (const props of [{ visible: false }, { disabled: true }, { cssDisabled: true }, { premium: true }, { href: '/register?f=file' }]) {
    const button = control(props);
    assert.equal(runProbe({ nodes: [button] }).kind, 'waiting');
    assert.equal(button.clicks, 0);
  }
});

test('espera do hospedador aparece no progresso sem alterar o contador', () => {
  const clock = control({ label: '366' });
  const result = runProbe({ clocks: [clock] });
  assert.equal(result.kind, 'waiting');
  assert.match(result.stage, /366s/);
  assert.equal(clock.textContent, '366');
  assert.equal(result.remainingSeconds, 366);
});

test('relógio do hospedador em minutos:segundos é convertido para o contador do app', () => {
  assert.equal(runProbe({ clocks: [control({ label: '02:15' })] }).remainingSeconds, 135);
  assert.equal(runProbe({ clocks: [control({ label: '01:02:03' })] }).remainingSeconds, 3723);
});

test('CAPTCHA solicita interação manual enquanto login continua sendo informado como bloqueio', () => {
  assert.equal(runProbe({ captcha: [control()] }).kind, 'verification');
  assert.equal(runProbe({ href: 'https://asdocs.net/register?f=file' }).kind, 'blocked');
});

test('não clica no CAPTCHA nem no download antes da verificação manual', () => {
  const captcha = control(), download = control();
  const result = runProbe({ captcha: [captcha], nodes: [download] });
  assert.equal(result.kind, 'verification');
  assert.equal(captcha.clicks, 0);
  assert.equal(download.clicks, 0);
});

test('widget pode continuar visível após resposta manual e o download retoma', () => {
  const captcha = control(), download = control();
  assert.equal(runProbe({ captcha: [captcha], nodes: [download] }).kind, 'verification');
  const result = runProbe({ captcha: [captcha], nodes: [download], responses: [{ value: 'fixture-human-completed-token' }] });
  assert.equal(result.kind, 'clicked');
  assert.equal(download.clicks, 1);
  assert.equal(captcha.clicks, 0);
});

test('CAPTCHA que expira pode ser feito novamente sem perder o fluxo do download', () => {
  const captcha = control(), download = control();
  const response = { value: 'fixture-human-completed-token' };
  runProbe({ captcha: [captcha], nodes: [download], responses: [response] });
  assert.equal(download.clicks, 1);
  response.value = '';
  assert.equal(runProbe({ captcha: [captcha], nodes: [download], responses: [response] }).kind, 'verification');
  response.value = 'fixture-new-human-completed-token';
  assert.equal(runProbe({ captcha: [captcha], nodes: [download], responses: [response] }).kind, 'clicked');
  assert.equal(download.clicks, 2);
});

test('formulário de download pode continuar após CAPTCHA, sem submeter cadastro', () => {
  const responses = [{ value: 'fixture-human-completed-token' }];
  const submit = control({ label: 'Continuar', tag: 'button', form: { getAttribute: () => '/download' } });
  assert.equal(runProbe({ nodes: [submit], responses }).kind, 'clicked');
  const register = control({ label: 'Submit', tag: 'button', form: { getAttribute: () => '/register' } });
  assert.notEqual(runProbe({ nodes: [register], responses }).kind, 'clicked');
  assert.equal(register.clicks, 0);
});

test('página de verificação do hospedador abre interação mesmo sem widget acessível', () => {
  assert.equal(runProbe({ title: 'Just a moment...' }).kind, 'verification');
});

test('HTML com CAPTCHA usa a sessão dinâmica mesmo que contenha um link de arquivo', async () => {
  let dynamic = false, requests = 0;
  const download = createBookDownloader({ parse,
    fetchResource: async (url) => { requests++; return { url, blob: new Blob(['<html><body><div class="g-recaptcha"></div><a download="" href="/ready.pdf">Baixar</a></body></html>']) }; },
    resolveHosted: async () => { dynamic = true; return new Blob(['%PDF-1.7']); },
  });
  await download('https://asdocs.net/file');
  assert.ok(dynamic);
  assert.equal(requests, 1);
});

test('botão dinâmico do MediaFire é reconhecido pelo identificador', () => {
  const button = control({ id: 'downloadButton', label: 'Download (2 MB)', tag: 'a' });
  assert.equal(runProbe({ nodes: [button], href: 'https://www.mediafire.com/file/book' }).kind, 'clicked');
  assert.equal(button.clicks, 1);
});

test('hospedadores dinâmicos têm lista explícita e exigem HTTPS', () => {
  assert.ok(supportsHostedDownload('https://asdocs.net/arquivo'));
  assert.ok(supportsHostedDownload('https://www.mediafire.com/file/arquivo'));
  for (const url of ['https://asdocs.net.evil.test/file', 'https://evil-asdocs.net/file', 'http://asdocs.net/file', 'javascript:alert(1)']) assert.equal(supportsHostedDownload(url), false);
});

test('não segue link de cadastro como se fosse o arquivo do livro', () => {
  const doc = parse('<html><body><a href="/register?f=L9bg">BAIXAR AGORA</a><a href="/upgrade">Download</a></body></html>');
  assert.deepEqual(downloadTargets(doc, 'https://asdocs.net/L9bg'), []);
});

test('uma página ASDocs sem href final aciona a resolução dinâmica dentro do app', async () => {
  let resolved;
  const download = createBookDownloader({
    parse,
    fetchResource: async (url) => ({ url, blob: new Blob(['<html><body><div onclick="startDownload()">DOWNLOAD LENTO</div></body></html>']) }),
    resolveHosted: async (url, progress) => { resolved = url; progress(-1, 'Aguardando liberação'); return new Blob(['%PDF-1.7']); },
  });
  const stages = [];
  const blob = await download('https://asdocs.net/file', (_p, stage) => stages.push(stage));
  assert.equal(resolved, 'https://asdocs.net/file');
  assert.equal(await blob.text(), '%PDF-1.7');
  assert.ok(stages.includes('Aguardando liberação'));
});

test('resolvedor preserva sessão e progresso apenas da solicitação correspondente', async () => {
  let callback, removed = false, received;
  const stages = [];
  const resolver = createHostedResolver({
    native: () => true,
    plugin: {
      addListener: async (_event, cb) => { callback = cb; return { remove: async () => { removed = true; } }; },
      resolve: async ({ requestId }) => {
        callback({ requestId: 'outro-download', stage: 'Ignorar' });
        callback({ requestId, stage: 'Aguardando liberação: 20s' });
        return { url: 'https://files.asdocs.net/book.epub', referer: 'https://asdocs.net/file', headers: { Cookie: 'session=fixture', 'User-Agent': 'WebView' } };
      },
    },
    fetchResource: async (url, _progress, options) => { received = { url, options }; return { blob: new Blob(['PK\x03\x04']) }; },
  });
  await resolver('https://asdocs.net/file', (_p, stage) => stages.push(stage));
  assert.ok(removed);
  assert.equal(received.options.headers.Cookie, 'session=fixture');
  assert.equal(received.options.referer, 'https://asdocs.net/file');
  assert.ok(stages.includes('Aguardando liberação: 20s'));
  assert.ok(!stages.includes('Ignorar'));
});

test('limpa o listener ao rejeitar login e não devolve HTML como livro', async () => {
  for (const fails of [true, false]) {
    let removed = false;
    const resolver = createHostedResolver({ native: () => true, plugin: {
      addListener: async () => ({ remove: async () => { removed = true; } }),
      resolve: async () => { if (fails) throw new Error('O hospedador exige conta ou login'); return { url: 'https://asdocs.net/ready' }; },
    }, fetchResource: async () => ({ blob: new Blob(['<html>login</html>']) }) });
    await assert.rejects(resolver('https://asdocs.net/file'), /login|página em vez/);
    assert.ok(removed);
  }
});

test('resolução dinâmica no navegador explica que é necessário o APK', async () => {
  const resolver = createHostedResolver({ native: () => false });
  await assert.rejects(resolver('https://asdocs.net/file'), /APK atualizado/);
});

test('sessão não é enviada para outro domínio durante redirect do arquivo', async () => {
  const requests = [];
  await nativeResource('https://asdocs.net/ready', undefined, { headers: { Cookie: 'private=fixture', 'User-Agent': 'WebView' } }, async (options) => {
    requests.push(options);
    return requests.length === 1 ? { status: 302, headers: { Location: 'https://cdn.test/book.pdf' } }
      : { status: 200, headers: {}, data: Buffer.from('%PDF-1.7').toString('base64') };
  });
  assert.equal(requests[0].headers.Cookie, 'private=fixture');
  assert.equal(requests[1].headers.Cookie, undefined);
  assert.equal(requests[1].headers['User-Agent'], 'WebView');
});

test('dois livros aguardam o resolvedor sem disputar a WebView ativa', async () => {
  let active = 0, maximum = 0, calls = 0;
  const resolver = createHostedResolver({ native: () => true, plugin: {
    addListener: async () => ({ remove: async () => {} }),
    resolve: async () => {
      maximum = Math.max(maximum, ++active); calls++;
      await new Promise((r) => setTimeout(r, 5)); active--;
      return { url: 'https://asdocs.net/ready.pdf' };
    },
  }, fetchResource: async () => ({ blob: new Blob(['%PDF-1.7']) }) });
  const stages = [];
  await Promise.all([resolver('https://asdocs.net/a'), resolver('https://asdocs.net/b', (_p, stage) => stages.push(stage))]);
  assert.equal(maximum, 1);
  assert.equal(calls, 2);
  assert.ok(stages.some((s) => s.includes('outro download')));
});
