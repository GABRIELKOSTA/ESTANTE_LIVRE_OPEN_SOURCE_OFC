import { downloadBook } from './download.js';
import { coverCache } from './images.js';
import { assertBookFile, downloadKey } from './download-links.js';
import { downloadChapterGroup } from './chapter-collections.js';
import { progressTiming } from './download-time.js';

export const DOWNLOAD_STARTED = 'Pronto! Pode ir ler outra coisa enquanto esperamos e baixamos para você! Assim que tiver pronto, te avisamos';

// Owned by App so navigation away from Discover does not discard downloads.
export function createDownloadManager({ importBlob, notify, fetchBook = downloadBook, loadCover = (url, referer) => coverCache.load(url, referer), now = Date.now }) {
  let jobs = {};
  const listeners = new Set(), running = new Map();
  const update = (key, value) => { jobs = { ...jobs, [key]: value }; listeners.forEach((fn) => fn(jobs)); };
  return {
    snapshot: () => jobs,
    subscribe(fn) { listeners.add(fn); fn(jobs); return () => listeners.delete(fn); },
    download(file, item, source) {
      const key = downloadKey(file, item, source);
      if (running.has(key)) return running.get(key);
      if (jobs[key]?.done) return Promise.resolve(jobs[key]);
      update(key, { p: 0, title: file.title || item.title || item.name || 'livro', startedAt: now(), phase: 'preparing' });
      notify(DOWNLOAD_STARTED, 'info', 9000);
      const task = Promise.resolve().then(async () => {
        try {
          const title = file.title || item.title || item.name || 'livro';
          const onProgress = (p, stage, details) => update(key, { ...progressTiming(jobs[key], p, stage, details, now()), title });
          const blob = file.build ? await file.build(onProgress) : await fetchBook(file.url, onProgress, { referer: item.url });
          await assertBookFile(blob);
          onProgress(-1, 'Salvando na estante…', { phase: 'saving' });
          const cover = file.cover || item.cover;
          const coverBlob = cover ? await loadCover(cover.replace(/^http:/, 'https:'), item.url).catch(() => undefined) : undefined;
          const book = await importBlob(blob, {
            name: `${title}.${file.format}`, title: file.title || item.title, author: item.author, coverBlob,
            source: file.sourceUrl || file.url || source.name, language: item.lang, chapterGroup: downloadChapterGroup(file, item, source),
          });
          update(key, { done: true, bookId: book.id, title: book.title });
          notify(`“${book.title}” está pronto! Já pode ler na estante.`, 'ok', 7000);
          return book;
        } catch (error) {
          update(key, { error: error.message, title: file.title || item.title });
          notify('Falha no download: ' + error.message, 'error', 7000);
          return null;
        } finally { running.delete(key); }
      });
      running.set(key, task);
      return task;
    },
  };
}
