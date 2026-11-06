import test from 'node:test';
import assert from 'node:assert/strict';
import { createDownloadManager, DOWNLOAD_STARTED } from '../src/lib/download-manager.js';
import { planChapterImport, downloadChapterGroup } from '../src/lib/chapter-collections.js';

const group = (chapter, key = 'hqnow:7') => ({ key, name: key === 'hqnow:7' ? 'Uma HQ' : 'Outra HQ', chapterId: String(chapter), number: String(chapter) });
const book = (chapter, options = {}) => ({ id: 'book-' + chapter, title: 'Uma HQ #' + chapter, format: 'cbz', collectionId: null, progress: 0, chapterGroup: group(chapter), ...options });

test('outras fontes de HQ reconhecem edições numeradas sem misturar anos ou fontes', () => {
  const source = { id: 'multiversohq', kind: 'hq' };
  const a = downloadChapterGroup({}, { title: 'Uma HQ #1 (2025)' }, source);
  const b = downloadChapterGroup({}, { title: 'Uma HQ #2 (2025)' }, source);
  assert.equal(a.key, b.key);
  assert.notEqual(a.chapterId, b.chapterId);
  assert.notEqual(a.key, downloadChapterGroup({}, { title: 'Uma HQ #2 (2024)' }, source).key);
  assert.notEqual(a.key, downloadChapterGroup({}, { title: 'Uma HQ #2 (2025)' }, { id: 'outra', kind: 'hq' }).key);
  assert.equal(downloadChapterGroup({}, { title: 'Livro #1' }, { id: 'books', kind: 'livro' }), undefined);
});
function applyPlan(plan, books, collections) {
  if (plan.collection && !collections.some((c) => c.id === plan.collection.id)) collections.push(plan.collection);
  for (const next of [...plan.updates, plan.book]) {
    const index = books.findIndex((b) => b.id === next.id);
    if (index < 0) books.push(next); else books[index] = next;
  }
}

test('um capítulo fica avulso; o segundo cria a coletânea e ordena pelo número', () => {
  const books = [], collections = [];
  const first = planChapterImport(book(10), books, collections, () => 'collection');
  assert.equal(first.collection, undefined);
  applyPlan(first, books, collections);
  const second = planChapterImport(book(2), books, collections, () => 'collection');
  assert.equal(second.collection.name, 'Uma HQ');
  assert.equal(second.collection.autoGroupKey, 'hqnow:7');
  applyPlan(second, books, collections);
  assert.deepEqual(books.sort((a, b) => a.collOrder - b.collOrder).map((b) => b.chapterGroup.number), ['2', '10']);
  assert.ok(books.every((b) => b.collectionId === 'collection'));
});

test('capítulos seguintes reutilizam a coletânea e não misturam outra série', () => {
  const books = [], collections = [];
  for (const n of [3, 1, 2]) applyPlan(planChapterImport(book(n), books, collections, () => 'collection'), books, collections);
  assert.equal(collections.length, 1);
  const other = planChapterImport(book(4, { chapterGroup: group(4, 'hqnow:8') }), books, collections, () => 'other');
  assert.equal(other.book.collectionId, null);
  assert.equal(other.collection, undefined);
  assert.deepEqual(books.sort((a, b) => a.collOrder - b.collOrder).map((b) => b.chapterGroup.number), ['1', '2', '3']);
});

test('baixar o mesmo capítulo novamente não conta como dois e preserva progresso', () => {
  const saved = book(1, { progress: 0.6, location: { page: 8 }, bookmarks: [{ id: 'mark' }], favorite: true, order: 4 });
  const plan = planChapterImport(book(1, { id: 'new-id' }), [saved], [], () => 'collection');
  assert.equal(plan.collection, undefined);
  assert.equal(plan.book.id, saved.id);
  assert.equal(plan.book.progress, 0.6);
  assert.deepEqual(plan.book.location, { page: 8 });
  assert.equal(plan.book.favorite, true);
});

test('o primeiro capítulo de versões anteriores pode ser incluído pelo link salvo', () => {
  const legacy = book(1, { chapterGroup: undefined, source: 'https://www.hq-now.com/hq-reader/7/uma-hq/chapter/1/page/1', progress: 0.4 });
  const plan = planChapterImport(book(2), [legacy], [], () => 'collection');
  assert.equal(plan.collection.name, 'Uma HQ');
  assert.equal(plan.updates[0].id, legacy.id);
  assert.equal(plan.updates[0].progress, 0.4);
});

test('coletâneas manuais e livros comuns não são reorganizados', () => {
  const manual = book(1, { collectionId: 'manual' });
  const plan = planChapterImport(book(2), [manual], [{ id: 'manual', name: 'Escolha pessoal' }], () => 'auto');
  assert.equal(plan.collection, undefined);
  assert.deepEqual(plan.updates, []);
  const normal = planChapterImport({ id: 'epub', format: 'epub', title: 'Um livro', collectionId: null }, [], [], () => 'auto');
  assert.equal(normal.collection, undefined);
});

test('download continua sem a tela assinante e avisa quando termina', async () => {
  let release;
  const notifications = [], imported = [];
  const manager = createDownloadManager({
    notify: (...args) => notifications.push(args),
    fetchBook: () => new Promise((resolve) => { release = resolve; }),
    importBlob: async (_blob, meta) => { imported.push(meta); return { id: 'ready', title: meta.title }; },
  });
  const detach = manager.subscribe(() => {});
  const task = manager.download({ url: 'https://files.test/book.pdf', format: 'pdf' }, { key: 'book', title: 'Meu livro' }, { id: 'source', name: 'Fonte' });
  assert.equal(notifications[0][0], DOWNLOAD_STARTED);
  assert.equal(notifications[0][2], 9000);
  detach(); // Sair de Descobrir para abrir o leitor não cancela a tarefa.
  await Promise.resolve();
  release(new Blob(['%PDF-1.7']));
  await task;
  assert.equal(imported.length, 1);
  assert.equal(manager.snapshot()['https://files.test/book.pdf'].bookId, 'ready');
  assert.match(notifications.at(-1)[0], /Meu livro.*está pronto/);
  let restored;
  manager.subscribe((jobs) => { restored = jobs; })();
  assert.ok(restored['https://files.test/book.pdf'].done);
});

test('cliques repetidos durante o download compartilham a mesma tarefa', async () => {
  let builds = 0;
  const manager = createDownloadManager({ notify: () => {}, importBlob: async () => ({ id: 'done', title: 'Uma HQ' }) });
  const file = { key: 'chapter', format: 'cbz', build: async () => { builds++; return new Blob(['PK\x03\x04']); } };
  const a = manager.download(file, { key: 'hq' }, { id: 'hqnow' });
  const b = manager.download(file, { key: 'hq' }, { id: 'hqnow' });
  assert.equal(a, b);
  await a;
  assert.equal(builds, 1);
});

test('capítulos concluídos fora de ordem geram uma só coletânea pelo importador', async () => {
  const books = [], collections = [];
  let counter = 0;
  const manager = createDownloadManager({
    notify: () => {}, importBlob: async (_blob, meta) => {
      const next = { id: String(++counter), title: meta.title, format: 'cbz', chapterGroup: meta.chapterGroup, collectionId: null };
      const plan = planChapterImport(next, books, collections, () => 'collection');
      applyPlan(plan, books, collections); return plan.book;
    },
  });
  const file = (n) => ({ key: 'chapter-' + n, title: 'Uma HQ #' + n, format: 'cbz', chapterGroup: group(n), build: async () => {
    if (n === 1) await new Promise((r) => setTimeout(r, 10));
    return new Blob(['PK\x03\x04']);
  } });
  await Promise.all([manager.download(file(1), { key: 'series' }, { id: 'hqnow' }), manager.download(file(2), { key: 'series' }, { id: 'hqnow' })]);
  assert.equal(collections.length, 1);
  assert.equal(books.length, 2);
  assert.deepEqual(books.sort((a, b) => a.collOrder - b.collOrder).map((b) => b.chapterGroup.number), ['1', '2']);
});

test('falha em segundo plano informa o erro e permite nova tentativa', async () => {
  let attempts = 0;
  const notifications = [];
  const manager = createDownloadManager({ notify: (msg) => notifications.push(msg), importBlob: async () => ({ id: 'ready', title: 'Livro' }), fetchBook: async () => {
    if (++attempts === 1) throw new Error('Sem conexão'); return new Blob(['%PDF-1.7']);
  } });
  const file = { url: 'https://files.test/book.pdf', format: 'pdf' };
  await manager.download(file, { key: 'book', title: 'Livro' }, { id: 'source' });
  assert.match(manager.snapshot()[file.url].error, /Sem conexão/);
  await manager.download(file, { key: 'book', title: 'Livro' }, { id: 'source' });
  assert.ok(manager.snapshot()[file.url].done);
  assert.ok(notifications.some((n) => n.includes('Falha no download')));
});
