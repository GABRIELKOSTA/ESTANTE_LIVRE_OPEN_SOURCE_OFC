import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, progressTiming, downloadTimeLabel } from '../src/lib/download-time.js';
import { createDownloadManager } from '../src/lib/download-manager.js';

test('tempo aparece como minutos:segundos e também suporta horas', () => {
  assert.equal(formatDuration(366), '06:06');
  assert.equal(formatDuration(60), '01:00');
  assert.equal(formatDuration(2.1), '00:03');
  assert.equal(formatDuration(-10), '00:00');
  assert.equal(formatDuration(3661), '01:01:01');
});

test('contador usa um prazo absoluto e continua correto ao retornar para a tela', () => {
  const job = progressTiming({ startedAt: 1000 }, -1, 'Aguardando liberação', { phase: 'waiting', remainingSeconds: 60 }, 1000);
  assert.equal(downloadTimeLabel(job, 1000), 'Liberação em 01:00');
  assert.equal(downloadTimeLabel(job, 21000), 'Liberação em 00:40');
  assert.equal(downloadTimeLabel(job, 60000), 'Liberação em 00:01');
  assert.match(downloadTimeLabel(job, 61000), /Aguardando liberação/);
  assert.equal(job.done, undefined);
});

test('CAPTCHA pausa a contagem e o novo prazo só vem após a verificação', () => {
  const waiting = progressTiming({ startedAt: 1000 }, -1, 'Liberação', { phase: 'waiting', remainingSeconds: 60 }, 1000);
  const captcha = progressTiming(waiting, -1, 'Marque o CAPTCHA', { phase: 'verification' }, 10000);
  assert.equal(captcha.waitUntil, undefined);
  assert.equal(downloadTimeLabel(captcha, 90000), 'Aguardando você marcar o CAPTCHA');
  const resumed = progressTiming(captcha, -1, 'Aguardando liberação', { phase: 'waiting', remainingSeconds: 30 }, 90000);
  assert.equal(downloadTimeLabel(resumed, 95000), 'Liberação em 00:25');
});

test('download estima tempo somente quando há avanço medido em duas amostras', () => {
  let job = progressTiming({ startedAt: 1000 }, 0.25, undefined, {}, 2000);
  assert.equal(job.etaUntil, undefined);
  job = progressTiming(job, 0.5, undefined, {}, 4000);
  assert.equal(job.etaUntil, 8000);
  assert.match(downloadTimeLabel(job, 4000), /cerca de 00:04 restantes/);
  assert.match(downloadTimeLabel(job, 6000), /cerca de 00:02 restantes/);
  const saving = progressTiming(job, -1, 'Salvando na estante…', { phase: 'saving' }, 7000);
  assert.equal(saving.etaUntil, undefined);
  assert.equal(downloadTimeLabel(saving, 7000), 'Salvando na estante…');
});

test('prazo desconhecido e fila mostram tempo decorrido sem inventar um restante', () => {
  const waiting = progressTiming({ startedAt: 1000 }, -1, 'Aguardando liberação', { phase: 'waiting' }, 1000);
  assert.equal(waiting.waitUntil, undefined);
  assert.match(downloadTimeLabel(waiting, 12100), /00:11 decorridos \(prazo não informado\)/);
  const queued = progressTiming({ startedAt: 1000 }, -1, 'Aguardando preparação de outro download…', {}, 1000);
  assert.equal(downloadTimeLabel(queued, 5000), 'Na fila · 00:04 decorridos');
});

test('status anterior em texto e correções do prazo pelo servidor são reconhecidos', () => {
  let job = progressTiming({ startedAt: 1000 }, -1, 'Aguardando liberação: 120s', {}, 1000);
  assert.equal(downloadTimeLabel(job, 1000), 'Liberação em 02:00');
  job = progressTiming(job, -1, 'Aguardando liberação: 30s', {}, 21000);
  assert.equal(downloadTimeLabel(job, 21000), 'Liberação em 00:30');
});

test('gerenciador conserva contadores separados ao navegar e receber progresso', async () => {
  let release, time = 1000;
  const manager = createDownloadManager({ now: () => time, notify: () => {}, importBlob: async () => ({ id: 'ready', title: 'Livro' }),
    fetchBook: async (_url, onProgress) => {
      onProgress(-1, 'Aguardando liberação', { phase: 'waiting', remainingSeconds: 60 });
      await new Promise((r) => { release = r; });
      return new Blob(['%PDF-1.7']);
    },
  });
  const task = manager.download({ url: 'https://files.test/book.pdf', format: 'pdf' }, { key: 'book', title: 'Livro' }, { id: 'source' });
  await Promise.resolve();
  time = 21000;
  assert.equal(downloadTimeLabel(manager.snapshot()['https://files.test/book.pdf'], time), 'Liberação em 00:40');
  release(); await task;
  assert.ok(manager.snapshot()['https://files.test/book.pdf'].done);
});
