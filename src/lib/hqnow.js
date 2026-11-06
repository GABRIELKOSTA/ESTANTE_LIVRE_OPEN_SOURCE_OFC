import JSZip from 'jszip';
import { getBlob, postJson } from './net.js';
import { httpUrl } from './download-links.js';
import { validateImage } from './images.js';

// Public GraphQL contract checked against the maintained HQ Now source:
// https://github.com/keiyoushi/extensions-source/tree/main/src/pt/hqnow
const API = 'https://admin.hq-now.com/graphql';
const SITE = 'https://www.hq-now.com';
const PAGE_SIZE = 24;
const queries = {
  search: ['EstanteHQSearch', 'query EstanteHQSearch($name: String!) { getHqsByName(name: $name) { id name publisherName } }', 'getHqsByName'],
  popular: ['EstanteHQPopular', 'query EstanteHQPopular($limit: Int, $orderByViews: Boolean, $loadCovers: Boolean) { getHqsByFilters(limit: $limit, orderByViews: $orderByViews, loadCovers: $loadCovers) { id name publisherName hqCover } }', 'getHqsByFilters'],
  details: ['EstanteHQDetails', 'query EstanteHQDetails($id: Int!) { getHqsById(id: $id) { id name publisherName synopsis hqCover capitulos { id number name } } }', 'getHqsById'],
  chapter: ['EstanteHQChapter', 'query EstanteHQChapter($chapterId: Int!) { getChapterById(chapterId: $chapterId) { name number pictures { pictureUrl } } }', 'getChapterById'],
};
const idOf = (value) => { const n = Number(value); if (!Number.isSafeInteger(n) || n <= 0) throw new Error('HQ Now: identificador inválido.'); return n; };
const text = (s) => typeof s === 'string' ? s.trim() : '';
const slug = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const escapeXml = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

async function imageType(blob) {
  const b = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  const s = String.fromCharCode(...b);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (s.startsWith('\x89PNG\r\n\x1a\n')) return 'png';
  if (/^GIF8[79]a/.test(s)) return 'gif';
  if (s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP') return 'webp';
  if (s.slice(4, 8) === 'ftyp' && /avif|avis/.test(s.slice(8))) return 'avif';
  if (s.startsWith('BM')) return 'bmp';
  throw new Error('O servidor não retornou uma imagem válida.');
}

export function createHQNowSource({ request = (url, data) => postJson(url, data, { referer: SITE + '/', origin: SITE }), download = getBlob, validate = validateImage, interval = 2000, now = Date.now, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  // Serialize API calls; image downloads use a separate, bounded worker pool.
  let running = false, nextRequest = 0;
  const queue = [];
  const pump = async () => {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const delay = nextRequest - now();
        if (delay > 0) await wait(delay);
        queue.sort((a, b) => a.priority - b.priority);
        const task = queue.shift();
        nextRequest = now() + interval;
        try {
          const [operationName, query, field] = queries[task.type];
          const result = await request(API, { operationName, query, variables: task.variables });
          if (result?.errors?.length) throw new Error('HQ Now: ' + result.errors.map((e) => e.message || 'Erro na consulta').join('; '));
          if (result?.data?.[field] == null) throw new Error('HQ Now: resposta inesperada do catálogo. Tente novamente mais tarde.');
          task.resolve(result.data[field]);
        } catch (e) { task.reject(e); }
      }
    } finally { running = false; }
  };
  const call = (type, variables, priority = 0) => {
    const task = { type, variables, priority };
    const promise = new Promise((resolve, reject) => { Object.assign(task, { resolve, reject }); queue.push(task); });
    promise.promote = () => { task.priority = 0; };
    pump();
    return promise;
  };
  const detailsCache = new Map();
  const details = (id, priority = 0) => {
    const cached = detailsCache.get(id);
    if (cached && now() - cached.time < 300000) { if (!priority) cached.promise.promote(); return cached.promise; }
    const promise = call('details', { id }, priority);
    promise.catch(() => detailsCache.delete(id));
    detailsCache.set(id, { promise, time: now() });
    return promise;
  };
  const list = (value) => { if (!Array.isArray(value)) throw new Error('HQ Now: lista de resultados inválida.'); return value; };
  const cache = new Map();
  const catalogue = (q) => {
    const key = q.toLocaleLowerCase('pt-BR');
    const hit = cache.get(key);
    if (hit && now() - hit.time < 300000) return hit.promise;
    const promise = call(q ? 'search' : 'popular', q ? { name: q } : { limit: 300, orderByViews: true, loadCovers: true }).then(list)
      .catch((e) => { cache.delete(key); throw e; });
    if (cache.size >= 20) cache.delete(cache.keys().next().value);
    cache.set(key, { time: now(), promise });
    return promise;
  };

  async function buildChapter(series, chapter, onProgress) {
    onProgress?.(0);
    const data = await call('chapter', { chapterId: idOf(chapter.id) });
    const pictures = list(data.pictures);
    if (!pictures.length) throw new Error('HQ Now: este capítulo ainda não tem páginas disponíveis.');
    const urls = pictures.map((p) => httpUrl(p?.pictureUrl, SITE));
    if (urls.some((url) => !url)) throw new Error('HQ Now: o capítulo contém uma página sem endereço válido.');
    const zip = new JSZip();
    let cursor = 0, completed = 0, failure;
    const worker = async () => {
      while (!failure && cursor < urls.length) {
        const index = cursor++;
        try {
          const blob = await download(urls[index].replace(/^http:/, 'https:'), undefined, { referer: SITE + '/' });
          const ext = await imageType(blob);
          await validate(blob);
          zip.file(`${String(index + 1).padStart(6, '0')}.${ext}`, new Uint8Array(await blob.arrayBuffer()));
          completed++;
          onProgress?.(completed / (urls.length + 1));
        } catch (e) { failure ||= new Error(`HQ Now: falha na página ${index + 1}. ${e.message}`); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, urls.length) }, worker));
    if (failure) throw failure;
    zip.file('ComicInfo.xml', `<?xml version="1.0" encoding="utf-8"?><ComicInfo><Series>${escapeXml(series.title)}</Series><Number>${escapeXml(chapter.number)}</Number><Title>${escapeXml(chapter.name)}</Title><Writer>${escapeXml(series.author)}</Writer><LanguageISO>pt</LanguageISO><PageCount>${urls.length}</PageCount></ComicInfo>`);
    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.comicbook+zip', compression: 'STORE' });
    onProgress?.(1);
    return blob;
  }

  return {
    id: 'hqnow', name: 'HQ Now', site: 'HQ Now', lang: 'PT', kind: 'hq', color: '#f59e0b',
    async preview(item) {
      const records = list(await details(idOf(item.hqId), 1));
      const record = records.find((r) => Number(r.id) === Number(item.hqId));
      return { cover: httpUrl(record?.hqCover, SITE) || null };
    },
    async search(q = '', page = 1) {
      const records = await catalogue(q.trim());
      const seen = new Set();
      const items = records.filter((record) => {
        if (!record || !Number.isSafeInteger(Number(record.id)) || Number(record.id) <= 0 || !text(record.name) || seen.has(Number(record.id))) return false;
        seen.add(Number(record.id)); return true;
      }).map((record) => ({
        key: `hqnow:${record.id}`, hqId: Number(record.id), title: text(record.name), author: text(record.publisherName),
        cover: httpUrl(record.hqCover, SITE) || null, lang: 'pt', url: `${SITE}/hq/${record.id}/${slug(record.name)}`,
      }));
      return { items: items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), next: items.length > page * PAGE_SIZE ? page + 1 : null };
    },
    async resolve(item) {
      const records = list(await details(idOf(item.hqId)));
      const record = records.find((r) => Number(r.id) === Number(item.hqId));
      if (!record) throw new Error('HQ Now: esta HQ não está mais disponível.');
      const series = { title: text(record.name) || item.title, author: text(record.publisherName) || item.author, cover: httpUrl(record.hqCover, SITE) || item.cover };
      const chapters = list(record.capitulos || []);
      const seen = new Set();
      const files = chapters.filter((c) => {
        if (!c || !Number.isSafeInteger(Number(c.id)) || Number(c.id) <= 0 || seen.has(Number(c.id))) return false;
        seen.add(Number(c.id)); return true;
      }).sort((a, b) => String(a.number).localeCompare(String(b.number), 'pt-BR', { numeric: true }));
      return {
        ...series, description: text(record.synopsis), chapters: true,
        files: files.map((chapter) => {
          const label = `#${chapter.number ?? '?'}${text(chapter.name) ? ' · ' + text(chapter.name) : ''}`;
          return {
            key: `hqnow:chapter:${chapter.id}`, format: 'cbz', label, title: `${series.title} ${label}`, cover: series.cover,
            chapterGroup: { key: `hqnow:${item.hqId}`, name: series.title, chapterId: String(chapter.id), number: String(chapter.number ?? chapter.id) },
            sourceUrl: `${SITE}/hq-reader/${item.hqId}/${slug(series.title)}/chapter/${chapter.id}/page/1`,
            build: (onProgress) => buildChapter(series, chapter, onProgress),
          };
        }),
      };
    },
  };
}
