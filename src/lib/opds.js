// Catálogos OPDS (padrão aberto de bibliotecas digitais). O Project Gutenberg
// tem tratamento especial para oferecer capa e EPUB direto na busca.
import { getText } from './net.js';

export const CATALOGS = [
  {
    id: 'gutenberg', name: 'Project Gutenberg', note: '70 mil+ livros em domínio público',
    start: 'https://www.gutenberg.org/ebooks/search.opds/?query=l.pt&sort_order=downloads',
    search: (q) => `https://www.gutenberg.org/ebooks/search.opds/?query=${encodeURIComponent(q)}`,
  },
  {
    id: 'gutenberg-top', name: 'Gutenberg — mais baixados', note: 'Clássicos em todos os idiomas',
    start: 'https://www.gutenberg.org/ebooks/search.opds/?sort_order=downloads',
    search: (q) => `https://www.gutenberg.org/ebooks/search.opds/?query=${encodeURIComponent(q)}`,
  },
];

const ATOM = 'http://www.w3.org/2005/Atom';
const abs = (href, base) => { try { return new URL(href, base).href; } catch { return href; } };

export async function loadFeed(url) {
  const xml = await getText(url);
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('O catálogo não respondeu em OPDS.');
  const feedTitle = doc.getElementsByTagNameNS(ATOM, 'title')[0]?.textContent || 'Catálogo';
  let next = null;
  for (const l of doc.documentElement.children) {
    if (l.localName === 'link' && l.getAttribute('rel') === 'next') next = abs(l.getAttribute('href'), url);
  }
  const entries = [];
  for (const e of doc.getElementsByTagNameNS(ATOM, 'entry')) {
    const get = (tag) => e.getElementsByTagNameNS(ATOM, tag)[0]?.textContent?.trim() || '';
    const id = get('id');
    const links = [...e.getElementsByTagNameNS(ATOM, 'link')].map((l) => ({
      rel: l.getAttribute('rel') || '', type: l.getAttribute('type') || '', href: abs(l.getAttribute('href'), url), title: l.getAttribute('title') || '',
    }));
    const author = e.getElementsByTagNameNS(ATOM, 'author')[0]?.getElementsByTagNameNS(ATOM, 'name')[0]?.textContent || get('content');
    const entry = { id, title: get('title'), author, summary: get('summary'), cover: null, downloads: [], nav: null };
    const img = links.find((l) => /image$/.test(l.rel) && !l.href.startsWith('data:')) || links.find((l) => /thumbnail/.test(l.rel) && !l.href.startsWith('data:'));
    if (img) entry.cover = img.href;
    for (const l of links) {
      if (/acquisition/.test(l.rel) || /epub|pdf/.test(l.type)) {
        if (/epub/.test(l.type)) entry.downloads.push({ format: 'epub', href: l.href, label: l.title || 'EPUB' });
        else if (/pdf/.test(l.type)) entry.downloads.push({ format: 'pdf', href: l.href, label: l.title || 'PDF' });
      }
    }
    const gid = id.match(/gutenberg\.org\/ebooks\/(\d+)/);
    if (gid) {
      const n = gid[1];
      entry.cover = `https://www.gutenberg.org/cache/epub/${n}/pg${n}.cover.medium.jpg`;
      if (!entry.downloads.length) entry.downloads.push({ format: 'epub', href: `https://www.gutenberg.org/ebooks/${n}.epub3.images`, label: 'EPUB' });
      entry.title = entry.title.replace(/\s*\((Portuguese|English|French|Spanish|German|Italian)\)\s*$/i, (m, lang) => '');
      entry.lang = (id && get('title').match(/\((\w+)\)\s*$/)?.[1]) || '';
    }
    if (!entry.downloads.length) {
      const nav = links.find((l) => /subsection|navigation|collection/.test(l.rel) || /opds-catalog|atom\+xml/.test(l.type));
      if (nav) entry.nav = nav.href;
    }
    if (entry.downloads.length || entry.nav) entries.push(entry);
  }
  return { title: feedTitle, entries, next };
}
