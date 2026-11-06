import * as db from './db.js';
import { openEpub } from './epub.js';
import { openPdf, pdfCover, closePdf, pageText } from './pdf.js';
import { normLang, detectText, detectTitle } from './lang.js';
import { openComic } from './comic.js';
import { validateImage } from './images.js';
import JSZip from 'jszip';

async function sniff(blob, name = '') {
  const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
  const s = String.fromCharCode(...head);
  if (s.startsWith('%PDF')) return 'pdf';
  if (s.startsWith('Rar!')) return 'cbr';
  if (s.startsWith('7z')) return 'cb7';
  if (s.startsWith('PK')) {
    if (/\.cb[zr]$/i.test(name)) return 'cbz';
    if (/\.epub$/i.test(name)) return 'epub';
    try {
      const zip = await JSZip.loadAsync(blob);
      if (zip.file('META-INF/container.xml')) return 'epub';
      if (Object.keys(zip.files).some((n) => /\.(jpe?g|png|webp|gif)$/i.test(n))) return 'cbz';
    } catch { /* não é zip válido */ }
    return 'epub';
  }
  if (/\.pdf$/i.test(name)) return 'pdf';
  if (/\.epub$/i.test(name)) return 'epub';
  return null;
}

export const isComic = (f) => f === 'cbz' || f === 'cbr' || f === 'cb7';

// Reduz uma imagem para usar como capa (máx. 900px de altura, JPEG).
export async function shrinkImage(blob, max = 900) {
  try {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, max / bmp.height);
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.86));
  } catch { return blob; }
}

export async function dominantColor(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = c.height = 12;
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0, 12, 12);
    const d = ctx.getImageData(0, 0, 12, 12).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const max = Math.max(d[i], d[i + 1], d[i + 2]), min = Math.min(d[i], d[i + 1], d[i + 2]);
      const w = 1 + (max - min) / 40; // valoriza pixels saturados
      r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; n += w;
    }
    const hex = (v) => Math.round(v / n).toString(16).padStart(2, '0');
    return '#' + hex(r) + hex(g) + hex(b);
  } catch { return null; }
}

export function hashColor(text = '') {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 55% 38%)`;
}

const cleanName = (name) => name.replace(/\.(epub|pdf|cbr|cbz|cb7)$/i, '').replace(/[_-]+/g, ' ').trim();

// Descobre o idioma: metadados primeiro, depois o próprio texto (ou o título, em HQs).
export async function languageOf(format, blob, title = '') {
  try {
    if (format === 'epub') {
      const book = await openEpub(blob);
      let l = normLang(book.language);
      if (!l) {
        const n = book.spine.length;
        const picks = [...new Set([Math.floor(n / 2), Math.floor(n / 3), n - 1].filter((i) => i >= 0))];
        let txt = '';
        for (const i of picks) txt += ' ' + (await book.chapterText(i)).slice(0, 6000);
        l = detectText(txt);
      }
      book.destroy();
      return l || detectTitle(title);
    }
    if (format === 'pdf') {
      const doc = await openPdf(blob);
      const info = await doc.getMetadata().catch(() => null);
      let l = normLang(info?.info?.Language);
      if (!l) {
        let txt = '';
        for (let k = 1; k <= Math.min(doc.numPages, 6) && txt.length < 6000; k++) txt += ' ' + (await pageText(doc, k).catch(() => ''));
        l = detectText(txt);
      }
      closePdf(doc);
      return l || detectTitle(title);
    }
    return detectTitle(title);
  } catch { return detectTitle(title); }
}

export async function importBook(blob, { name = '', title, author, coverBlob, source, language, chapterGroup } = {}) {
  const format = await sniff(blob, name);
  if (!format) throw new Error(`"${name || 'arquivo'}" não é EPUB, PDF, CBR ou CBZ.`);
  let meta = { title: '', author: '' };
  let cover = coverBlob || null;
  if (format === 'epub') {
    const book = await openEpub(blob);
    meta = { title: book.title, author: book.author };
    if (!cover) cover = await book.getCover().catch(() => null);
    book.destroy();
  } else if (isComic(format)) {
    const comic = await openComic(blob);
    try {
      const firstPage = await validateImage(await comic.pageBlob(0));
      meta = { title: comic.info.title || '', author: comic.info.author || '' };
      if (!cover) cover = await shrinkImage(firstPage).catch(() => null);
    } finally { comic.destroy(); }
  } else {
    const doc = await openPdf(blob);
    const info = await doc.getMetadata().catch(() => null);
    meta = { title: info?.info?.Title || '', author: info?.info?.Author || '' };
    if (!cover) cover = await pdfCover(doc).catch(() => null);
    closePdf(doc);
  }
  const id = db.uid();
  const t = title || meta.title || cleanName(name) || 'Sem título';
  const rec = {
    id, format, title: t, author: author || meta.author || '',
    cover, color: (cover && (await dominantColor(cover))) || hashColor(t),
    addedAt: Date.now(), openedAt: 0, progress: 0, location: null,
    collectionId: null, favorite: false, order: 0, collOrder: 0,
    size: blob.size, bookmarks: [], source: source || '',
    language: normLang(language) || (await languageOf(format, blob, t)),
    ...(isComic(format) || format === 'pdf' ? { chapterGroup } : {}),
  };
  return db.commitImport(blob, rec);
}

export const getFile = async (id) => (await db.get('files', id))?.blob;

// Livros importados antes da separação por idioma: classifica em segundo plano.
export async function detectMissingLanguages(books, onUpdate) {
  for (const b of books.filter((x) => x.language === undefined)) {
    const blob = await getFile(b.id).catch(() => null);
    const language = blob ? await languageOf(b.format, blob, b.title) : detectTitle(b.title);
    const next = { ...(await db.get('books', b.id)), language };
    await db.put('books', next);
    onUpdate?.(next);
  }
}
export const saveBook = (b) => db.put('books', b);
export const saveReadingProgress = (b) => db.patchBook(b.id, { progress: b.progress, location: b.location, openedAt: b.openedAt, bookmarks: b.bookmarks });
export async function deleteBook(id) { await db.del('books', id); await db.del('files', id); }

export async function loadLibrary() {
  const [books, collections] = await Promise.all([db.getAll('books'), db.getAll('collections')]);
  return { books, collections };
}

export async function createCollection(name, color, bookIds = []) {
  const { books, collections } = await loadLibrary();
  const order = Math.max(0, ...books.map((b) => b.order || 0), ...collections.map((c) => c.order || 0)) + 1;
  const col = { id: db.uid(), name, color, order, createdAt: Date.now() };
  await db.put('collections', col);
  const moved = books.filter((b) => bookIds.includes(b.id)).map((b, i) => ({ ...b, collectionId: col.id, collOrder: i }));
  if (moved.length) await db.putMany('books', moved);
  return col;
}
export const saveCollection = (c) => db.put('collections', c);
export async function deleteCollection(id) {
  const { books } = await loadLibrary();
  await db.putMany('books', books.filter((b) => b.collectionId === id).map((b) => ({ ...b, collectionId: null })));
  await db.del('collections', id);
}
export const saveOrder = (books, collections) => Promise.all([db.putMany('books', books), db.putMany('collections', collections)]);
