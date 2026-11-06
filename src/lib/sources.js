// Extensões de fontes: cada site vira uma "extensão" com busca e download dentro do app.
// Interface: { id, name, lang, site, search(q, page) -> {items, next}, resolve(item) -> {files} }
// item: { key, title, author, cover, url, files? }   file: { format, label, url | build() }
import JSZip from 'jszip';
import { getText, getPage } from './net.js';
import { loadFeed } from './opds.js';
import { normLang } from './lang.js';
import { httpUrl, directFile, decodeLabel } from './download-links.js';
import { createHQNowSource } from './hqnow.js';

const abs = httpUrl;
const enc = encodeURIComponent;
const clean = (s = '') => s.replace(/\s+/g, ' ').trim();
const fold = (s = '') => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const slugTitle = (slug) => decodeURIComponent(slug).replace(/[-_]+/g, ' ').replace(/\b(ebook|pdf|epub|livro)\b/gi, '').replace(/\s+/g, ' ').trim().replace(/^./, (c) => c.toUpperCase());

async function html(url) {
  const page = await getPage(url);
  const doc = new DOMParser().parseFromString(page.text, 'text/html');
  if (/just a moment|verifying you are human|enable javascript and cookies/i.test(doc.title || '')) throw new Error('A fonte bloqueou a consulta automática.');
  doc.sourceUrl = page.url;
  return doc;
}
async function json(url) { return JSON.parse(await getText(url)); }
async function xml(url) { return new DOMParser().parseFromString(await getText(url), 'application/xml'); }

const memo = new Map();
const cached = (key, fn) => { if (!memo.has(key)) memo.set(key, fn().catch((e) => { memo.delete(key); throw e; })); return memo.get(key); };

// Lê sitemaps (inclusive índices) e devolve as URLs que passam no filtro.
async function sitemap(url, test, depth = 0) {
  const doc = await xml(url);
  const locs = [...doc.getElementsByTagName('loc')].map((l) => l.textContent.trim());
  const isIndex = doc.documentElement.localName === 'sitemapindex';
  if (isIndex && depth < 2) {
    const subs = locs.filter((u) => test.index ? test.index.test(u) : true);
    const all = await Promise.all(subs.map((u) => sitemap(u, test, depth + 1).catch(() => [])));
    return all.flat();
  }
  return locs.filter((u) => test.item.test(u));
}

function sitemapSearch({ map, item, index, titleFrom }) {
  return async (q, page = 1) => {
    const urls = await cached('sm:' + map, () => sitemap(map, { item, index }));
    const t = fold(q.trim());
    const words = t.split(/\s+/).filter(Boolean);
    const list = urls
      .map((u) => ({ url: u, title: titleFrom ? titleFrom(u) : slugTitle(u.replace(/\/$/, '').split('/').pop().replace(/\.html?$/, '')) }))
      .filter((it) => !words.length || words.every((w) => fold(it.title + ' ' + it.url).includes(w)));
    const per = 24;
    const slice = list.slice((page - 1) * per, page * per);
    return { items: slice.map((it) => ({ key: it.url, title: it.title, author: '', cover: null, url: it.url })), next: list.length > page * per ? page + 1 : null };
  };
}

// Resultados de busca em HTML: links que batem com o padrão de página de livro.
function htmlSearch({ url, item, sameHost = true, selector = 'a[href]' }) {
  return async (q, page = 1) => {
    const target = url(q, page);
    const doc = await html(target);
    const base = doc.sourceUrl || target;
    const host = new URL(base).host;
    const map = new Map();
    for (const a of doc.querySelectorAll(selector)) {
      const href = abs(a.getAttribute('href'), base).split('#')[0];
      if (!href || (sameHost && new URL(href).host.replace(/^www\./, '') !== host.replace(/^www\./, ''))) continue;
      const path = new URL(href).pathname;
      if (!item && (/^\/(?:category|categoria|tag|author|autor|page|wp-content|wp-json|feed)(?:\/|$)/i.test(path) || /\.(?:png|jpe?g|webp|gif|svg)$/i.test(path) || path === '/')) continue;
      if (item ? !item.test(path) : selector === 'a[href]' && !a.closest('h1,h2,h3,h4')) continue;
      const cur = map.get(href) || { key: href, url: href, title: '', author: '', cover: null };
      const card = a.closest('article, .book, .livro, li, .book-card, .item, .post');
      const img = a.querySelector('img') || card?.querySelector('img');
      if (img && !cur.cover) cur.cover = abs(img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('src') || '', base) || null;
      const text = clean(a.textContent) || a.getAttribute('title') || img?.getAttribute('alt') || '';
      if (card && !cur.author) cur.author = clean(card.querySelector('a[href*="/autor/"]')?.textContent || '');
      if (text && text.length > cur.title.length && text.length < 200) cur.title = text.replace(/^Permalink to /, '');
      map.set(href, cur);
    }
    const items = [...map.values()].map((i) => ({ ...i, title: i.title || slugTitle(new URL(i.url).pathname.split('/').filter(Boolean).pop() || '') }));
    if (!items.length && !q) throw new Error('A fonte não retornou um catálogo de livros. Tente pesquisar um título.');
    const next = [...doc.querySelectorAll('a[href]')].some((a) =>
      a.getAttribute('rel')?.split(/\s+/).includes('next') || /^(pr[oó]xim[oa]|next|›|»)/i.test(clean(a.textContent)));
    return { items, next: next ? page + 1 : null };
  };
}

// Resolve arquivos e páginas intermediárias sem executar scripts dos sites.
async function genericResolve(item, { prefer } = {}) {
  const doc = await html(item.url);
  const meta = (p) => doc.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.getAttribute('content');
  const out = { title: clean(meta('og:title') || doc.querySelector('h1')?.textContent || item.title) || item.title, author: meta('author') || meta('book:author') || clean(doc.querySelector('a[href*="/autor/"]')?.textContent || '') || item.author, cover: item.cover || abs(meta('og:image') || '', item.url) || null, files: [], external: [] };
  const seen = new Set([item.url]), files = new Set(), queue = [];
  const origin = new URL(item.url).hostname.replace(/^www\./, '');
  const hoster = /(^|\.)(asdocs\.net|mediafire\.com|mega\.nz|drive\.google\.com|terabox\.com|1drv\.ms)$/i;
  const collect = (d, base, depth) => {
    const content = d.querySelector('.entry-content, .post-content, .single-content') || d.body;
    for (const a of content.querySelectorAll('a[href], iframe[src]')) {
      if (a.closest('.related-posts, .comment-list, #comments')) continue;
      const href = abs(a.getAttribute('href') || a.getAttribute('src'), base);
      if (!href || /kepub|azw3|\.mobi(?:$|[?#])/i.test(href)) continue;
      const file = directFile(href);
      if (file) {
        if (!files.has(file.url)) {
          files.add(file.url);
          out.files.push({ ...file, label: clean(a.textContent) || decodeLabel(new URL(file.url).pathname.split('/').pop()) || file.format.toUpperCase() });
        }
        continue;
      }
      const u = new URL(href);
      const hosted = hoster.test(u.hostname);
      const download = /download|baixar|\b(?:epub|pdf|cbr|cbz)\b/i.test(a.textContent + ' ' + u.pathname);
      if (hosted && !out.external.some((x) => x.url === href)) {
        out.external.push({ url: href, label: clean(a.textContent) || u.hostname });
        const format = clean(a.textContent).match(/\b(epub|pdf|cbr|cbz)\b/i)?.[1]?.toLowerCase();
        if ((format || download) && !files.has(href)) {
          files.add(href); out.files.push({ format: format || 'bin', url: href, label: format?.toUpperCase() || clean(a.textContent) || 'Arquivo da HQ', indirect: true });
        }
      }
      if (depth < 2 && !seen.has(href) && (hosted || (u.hostname.replace(/^www\./, '') === origin && download && !/^\/livro\//.test(u.pathname)))) {
        seen.add(href); queue.push({ url: href, depth: depth + 1 });
      }
    }
    const refresh = d.querySelector('meta[http-equiv="refresh" i]')?.getAttribute('content')?.match(/url\s*=\s*["']?([^"']+)/i)?.[1];
    const target = abs(refresh || '', base);
    if (target && !seen.has(target) && depth < 2) {
      seen.add(target);
      const file = directFile(target);
      if (file && !files.has(file.url)) { files.add(file.url); out.files.push({ ...file, label: file.format.toUpperCase() }); }
      else if (!file) queue.push({ url: target, depth: depth + 1 });
    }
  };
  collect(doc, doc.sourceUrl || item.url, 0);
  // Limite de requisições para não varrer acervos, anúncios ou loops de redirects.
  for (let count = 0; !out.files.length && queue.length && count < 4; count++) {
    const next = queue.shift();
    try {
      const d = await html(next.url);
      const file = directFile(d.sourceUrl);
      if (file && !files.has(file.url)) { files.add(file.url); out.files.push({ ...file, label: file.format.toUpperCase() }); }
      else if (!file) collect(d, d.sourceUrl || next.url, next.depth);
    } catch { /* hospedador continua disponível como link externo */ }
  }
  out.files.sort((a, b) => (prefer ? prefer(a) - prefer(b) : 0) || (a.format === 'epub' ? -1 : 1) - (b.format === 'epub' ? -1 : 1));
  return out;
}

// eLivros/dLivros expõem um índice HTML completo; a busca local evita depender
// do formulário de pesquisa dinâmico e permite paginar por título/autor.
function indexedBooks(base) {
  const featured = htmlSearch({ url: () => base + '/', item: /^\/livro\/[^/]+\/?$/ });
  return async (q, page = 1) => {
    if (!q.trim()) return page === 1 ? featured('', 1) : { items: [], next: null };
    const all = await cached('index:' + base, async () => {
      const doc = await html(base + '/page/SiteMap');
      const found = new Map();
      for (const a of doc.querySelectorAll('a[href]')) {
        const url = abs(a.getAttribute('href'), base);
        if (!url || new URL(url).origin !== new URL(base).origin || !/^\/livro\/[^/]+\/?$/.test(new URL(url).pathname)) continue;
        if (!found.has(url)) found.set(url, { key: url, url, title: clean(a.textContent) || slugTitle(new URL(url).pathname.split('/').pop()), author: '', cover: null });
      }
      if (!found.size) throw new Error('O índice do site não está disponível agora. Tente novamente.');
      return [...found.values()];
    });
    const words = fold(q).split(/\s+/).filter(Boolean);
    const items = all.filter((it) => words.every((w) => fold(it.title + ' ' + decodeLabel(it.url)).includes(w)));
    return { items: items.slice((page - 1) * 24, page * 24), next: items.length > page * 24 ? page + 1 : null };
  };
}

// ---------------- Internet Archive / Open Library
const iaCover = (id) => `https://archive.org/services/img/${id}`;
async function iaResolve(id, formats = ['epub', 'pdf', 'cbr', 'cbz']) {
  const m = await json(`https://archive.org/metadata/${enc(id)}`);
  const fmt = (n) => (/\.epub$/i.test(n) ? 'epub' : /\.cbr$/i.test(n) ? 'cbr' : /\.cbz$/i.test(n) ? 'cbz' : 'pdf');
  const rank = { cbz: 0, cbr: 1, epub: 2, pdf: 3 };
  const files = (m.files || [])
    .filter((f) => !f.private && formats.includes(fmt(f.name)) && (/\.(epub|cbr|cbz)$/i.test(f.name) || (/\.pdf$/i.test(f.name) && !/_text\.pdf$/i.test(f.name) && f.format !== 'Additional Text PDF')))
    .map((f) => ({ format: fmt(f.name), url: `https://archive.org/download/${enc(id)}/${f.name.split('/').map(enc).join('/')}`, label: f.name, size: +f.size || 0 }))
    .sort((a, b) => rank[a.format] - rank[b.format]);
  const md = m.metadata || {};
  return { title: [].concat(md.title || '')[0], author: [].concat(md.creator || '')[0], cover: iaCover(id), files: files.slice(0, 4) };
}

// ---------------- Wikisource → EPUB gerado no aparelho
async function wsParse(lang, page) {
  const j = await json(`https://${lang}.wikisource.org/w/api.php?action=parse&page=${enc(page)}&prop=text|links|displaytitle&format=json&formatversion=2&origin=*&redirects=1`);
  if (j.error) throw new Error(j.error.info);
  return j.parse;
}
function wsClean(htmlText) {
  const d = new DOMParser().parseFromString(`<div>${htmlText}</div>`, 'text/html');
  d.querySelectorAll('.mw-editsection, .ws-noexport, .noprint, #headertemplate, .ws-header, table.headertemplate, .navbox, style, script, .mw-references-wrap sup, .reference').forEach((n) => n.remove());
  d.querySelectorAll('a').forEach((a) => a.replaceWith(...a.childNodes));
  d.querySelectorAll('img').forEach((i) => i.remove());
  return d.body.firstElementChild;
}
async function buildWikisourceEpub(lang, page, onProgress) {
  const main = await wsParse(lang, page);
  const subs = [...new Set((main.links || []).filter((l) => l.ns === 0 && l.exists && l.title.startsWith(page + '/')).map((l) => l.title))].slice(0, 200);
  const chapters = [];
  if (subs.length) {
    for (const [k, t] of subs.entries()) {
      onProgress?.(k / subs.length);
      const p = await wsParse(lang, t).catch(() => null);
      if (p) chapters.push({ title: t.slice(page.length + 1).replace(/_/g, ' '), node: wsClean(p.text) });
    }
  } else chapters.push({ title: page, node: wsClean(main.text) });
  const ser = new XMLSerializer();
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  const xhtml = (title, body) => `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}"><head><title>${esc(title)}</title></head><body><h2>${esc(title)}</h2>${body}</body></html>`;
  chapters.forEach((c, i) => {
    const body = [...c.node.childNodes].map((n) => ser.serializeToString(n)).join('').replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '');
    zip.file(`OEBPS/c${i}.xhtml`, xhtml(c.title, body));
  });
  zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Sumário</title></head><body><nav epub:type="toc"><ol>${chapters.map((c, i) => `<li><a href="c${i}.xhtml">${esc(c.title)}</a></li>`).join('')}</ol></nav></body></html>`);
  const title = main.displaytitle ? clean(new DOMParser().parseFromString(main.displaytitle, 'text/html').body.textContent) : page;
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">wikisource:${lang}:${esc(page)}</dc:identifier><dc:title>${esc(title)}</dc:title><dc:language>${lang}</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${chapters.map((_, i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${chapters.map((_, i) => `<itemref idref="c${i}"/>`).join('')}</spine></package>`);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
}

// =====================================================================
export const SOURCES = [
  createHQNowSource(),
  {
    id: 'elivros', name: 'eLivros', site: 'eLivros', lang: 'PT', color: '#ea580c',
    search: indexedBooks('https://elivros.info'),
    resolve: (it) => genericResolve(it),
  },
  {
    id: 'dlivros', name: 'dLivros', site: 'dLivros', lang: 'PT', color: '#9333ea',
    search: indexedBooks('https://dlivros.com'),
    resolve: (it) => genericResolve(it),
  },
  {
    id: 'baixelivros', name: 'Baixe Livros', site: 'Baixe Livros', lang: 'PT', color: '#16a34a',
    search: htmlSearch({ url: (q, p) => `https://www.baixelivros.com.br/${p > 1 ? `page/${p}/` : ''}?s=${enc(q)}`, selector: 'h2 a[href], h3 a[href], .entry-title a[href]' }),
    resolve: (it) => genericResolve(it),
  },
  ...[
    ['soquadrinhos', 'Só Quadrinhos', 'https://site.soquadrinhos.com', '#dc2626'],
    ['multiversohq', 'Multiverso HQ', 'https://multiversohq.com', '#2563eb'],
    ['tudohqemanga', 'Tudo HQ e Mangá', 'https://tudohqemanga.com.br', '#7c3aed'],
  ].map(([id, name, base, color]) => ({
    id, name, site: name, lang: 'PT', kind: 'hq', color,
    search: htmlSearch({ url: (q, p) => `${base}/${p > 1 ? `page/${p}/` : ''}${q ? `?s=${enc(q)}` : ''}`, selector: 'h2 a[href], h3 a[href], h4 a[href], .entry-title a[href], .post-title a[href], .manga-title a[href], article a[href], .type-post a[href]' }),
    resolve: (it) => genericResolve(it),
  })),
  {
    id: 'archive-hq', name: 'Internet Archive · HQs', site: 'Internet Archive', lang: 'Multi', kind: 'hq', color: '#475569',
    async search(q, page = 1, lang = 'all') {
      const language = { pt: ' AND language:(por OR Portuguese OR pt)', en: ' AND language:(eng OR English OR en)' }[lang] || '';
      const query = `${q ? `(title:(${q}) OR creator:(${q})) AND ` : ''}mediatype:texts AND (format:(CBR OR CBZ) OR subject:(comics OR quadrinhos OR manga)) AND format:(CBR OR CBZ OR PDF OR "Text PDF") AND -access-restricted-item:true AND -collection:printdisabled AND -collection:inlibrary${language}`;
      const j = await json(`https://archive.org/advancedsearch.php?q=${enc(query)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=language&rows=24&page=${page}&output=json`);
      return {
        items: (j.response?.docs || []).map((d) => ({ key: d.identifier, ia: d.identifier, url: `https://archive.org/details/${enc(d.identifier)}`, title: [].concat(d.title || d.identifier)[0], author: [].concat(d.creator || '')[0], cover: iaCover(d.identifier), lang: normLang([].concat(d.language || '')[0]) })),
        next: j.response?.numFound > page * 24 ? page + 1 : null,
      };
    },
    resolve: (it) => iaResolve(it.ia, ['cbz', 'cbr', 'pdf']),
  },
  {
    id: 'gutenberg', name: 'Project Gutenberg', site: 'Project Gutenberg', lang: 'Multi', color: '#c2410c',
    async search(q, page = 1, lang = 'all') {
      const l = lang === 'all' ? '' : ` l.${lang}`;
      const query = q ? q + l : (l.trim() || 'l.pt');
      const url = `https://www.gutenberg.org/ebooks/search.opds/?query=${enc(query)}${q ? '' : '&sort_order=downloads'}&start_index=${(page - 1) * 25 + 1}`;
      const f = await loadFeed(url);
      return { items: f.entries.filter((e) => e.downloads.length).map((e) => ({ key: e.id, title: e.title, author: e.author, cover: e.cover, lang: normLang(e.lang) || (lang !== 'all' ? lang : ''), files: e.downloads.map((d) => ({ format: d.format, url: d.href, label: d.format.toUpperCase() })) })), next: f.next ? page + 1 : null };
    },
  },
  {
    id: 'archive', name: 'Internet Archive', site: 'Internet Archive', lang: 'Multi', color: '#64748b',
    async search(q, page = 1, lang = 'all') {
      const L = { pt: 'language:(por OR Portuguese OR pt OR "pt-BR")', en: 'language:(eng OR English OR en)' }[lang];
      const base = q ? `(title:(${q}) OR creator:(${q}))` : L || 'language:(por OR Portuguese)';
      const query = `${base}${q && L ? ' AND ' + L : ''} AND mediatype:texts AND format:(EPUB OR "Text PDF" OR PDF) AND -access-restricted-item:true AND -collection:printdisabled AND -collection:inlibrary`;
      const j = await json(`https://archive.org/advancedsearch.php?q=${enc(query)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=language${q ? '' : '&sort[]=downloads+desc'}&rows=24&page=${page}&output=json`);
      const docs = j.response?.docs || [];
      return { items: docs.map((d) => ({ key: d.identifier, ia: d.identifier, title: [].concat(d.title || d.identifier)[0], author: [].concat(d.creator || '')[0], cover: iaCover(d.identifier), lang: normLang([].concat(d.language || '')[0]) || (lang !== 'all' ? lang : '') })), next: j.response?.numFound > page * 24 ? page + 1 : null };
    },
    resolve: (it) => iaResolve(it.ia),
  },
  {
    id: 'openlibrary', name: 'Open Library', site: 'Open Library', lang: 'Multi', color: '#1e40af',
    async search(q, page = 1, lang = 'all') {
      const L = { pt: ' language:por', en: ' language:eng' }[lang] || '';
      const j = await json(`https://openlibrary.org/search.json?q=${enc((q || (L ? '' : 'language:por')) + L + ' ebook_access:public')}&fields=key,title,author_name,ia,cover_i,language&limit=24&page=${page}`);
      const items = (j.docs || []).filter((d) => d.ia?.length).map((d) => ({ key: d.key, ia: d.ia[0], title: d.title, author: (d.author_name || [])[0] || '', cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : iaCover(d.ia[0]), lang: lang !== 'all' ? lang : (d.language?.length === 1 ? normLang(d.language[0]) : '') }));
      return { items, next: j.numFound > page * 24 ? page + 1 : null };
    },
    resolve: (it) => iaResolve(it.ia),
  },
  {
    id: 'wikisource', name: 'Wikisource Português', site: 'Wikisource Português', lang: 'PT', color: '#334155',
    async search(q, page = 1) {
      const j = await json(`https://pt.wikisource.org/w/api.php?action=query&list=search&srsearch=${enc(q || 'Machado de Assis')}&srnamespace=0&srlimit=24&sroffset=${(page - 1) * 24}&format=json&origin=*`);
      const items = (j.query?.search || []).filter((s) => !s.title.includes('/')).map((s) => ({
        key: s.title, title: s.title, author: clean(new DOMParser().parseFromString(s.snippet, 'text/html').body.textContent).slice(0, 80), cover: null,
        files: [{ format: 'epub', label: 'EPUB (gerado)', build: (p) => buildWikisourceEpub('pt', s.title, p) }],
      }));
      return { items, next: j.continue ? page + 1 : null };
    },
  },
  {
    id: 'standardebooks', name: 'Standard Ebooks', site: 'Standard Ebooks', lang: 'EN', color: '#0f766e',
    search: htmlSearch({ url: (q, p) => `https://standardebooks.org/ebooks?query=${enc(q)}&page=${p}`, item: /^\/ebooks\/[^/]+\/[^/]+\/?$/ }),
    resolve: (it) => genericResolve(it, { prefer: (f) => (/_advanced/.test(f.url) ? 1 : 0) }),
  },
  {
    id: 'planetebook', name: 'Planet eBook', site: 'Planet eBook', lang: 'EN', color: '#7c3aed',
    search: htmlSearch({ url: (q, p) => `https://www.planetebook.com/page/${p}/?s=${enc(q || 'a')}` }),
    resolve: (it) => genericResolve(it),
  },
  {
    id: 'scielo', name: 'SciELO Livros', site: 'SciELO Livros', lang: 'PT', color: '#b45309',
    search: htmlSearch({ url: (q, p) => `https://books.scielo.org/page/${p}/?s=${enc(q || 'saude')}`, item: /^\/id\/[a-z0-9]+\/?$/i }),
    resolve: (it) => genericResolve(it, { prefer: (f) => (/-\d{2}\.pdf$/.test(f.url) ? 2 : 0) }),
  },
  {
    id: 'livris', name: 'Livris', site: 'Livris', lang: 'PT', color: '#be123c',
    search: sitemapSearch({ map: 'https://livris.com.br/sitemap.xml', item: /\/livros\/[^/]+\/?$/ }),
    resolve: (it) => genericResolve(it),
  },
  {
    id: 'infolivros', name: 'InfoLivros', site: 'InfoLivros', lang: 'PT', color: '#0369a1',
    search: sitemapSearch({ map: 'https://infolivros.org/sitemap.xml', index: /sitemap-livro\.xml/, item: /\/livro\/[^/]+\/?$/ }),
    resolve: (it) => genericResolve(it),
  },
  {
    id: 'globalgrey', name: 'Global Grey', site: 'Global Grey', lang: 'EN', color: '#4b5563',
    search: sitemapSearch({ map: 'https://www.globalgreyebooks.com/sitemap.xml', item: /globalgreyebooks\.com\/[^/]+-ebook\.html$/, titleFrom: (u) => slugTitle(u.split('/').pop().replace(/-ebook\.html$/, '')) }),
    resolve: (it) => genericResolve(it),
  },
  {
    id: 'openstax', name: 'OpenStax', site: 'OpenStax', lang: 'EN', color: '#0e7490',
    async search(q) {
      const j = await cached('openstax', () => json('https://openstax.org/apps/cms/api/v2/pages/?type=books.Book&fields=title,high_resolution_pdf_url,cover_url&limit=250'));
      const t = fold(q);
      const items = (j.items || []).filter((b) => b.high_resolution_pdf_url && (!t || fold(b.title).includes(t)))
        .map((b) => ({ key: String(b.id), title: b.title, author: 'OpenStax', cover: b.cover_url, files: [{ format: 'pdf', url: b.high_resolution_pdf_url, label: 'PDF' }] }));
      return { items, next: null };
    },
  },
  {
    id: 'arxiv', name: 'arXiv', site: 'arXiv', lang: 'EN', color: '#991b1b',
    async search(q, page = 1) {
      const doc = await xml(`https://export.arxiv.org/api/query?search_query=${enc('all:' + (q || 'book'))}&start=${(page - 1) * 20}&max_results=20`);
      const A = 'http://www.w3.org/2005/Atom';
      const items = [...doc.getElementsByTagNameNS(A, 'entry')].map((e) => {
        const g = (t) => clean(e.getElementsByTagNameNS(A, t)[0]?.textContent || '');
        const pdf = [...e.getElementsByTagNameNS(A, 'link')].find((l) => l.getAttribute('title') === 'pdf')?.getAttribute('href');
        return { key: g('id'), title: g('title'), author: [...e.getElementsByTagNameNS(A, 'author')].map((a) => clean(a.textContent)).slice(0, 2).join(', '), cover: null, files: pdf ? [{ format: 'pdf', url: pdf.replace(/^http:/, 'https:'), label: 'PDF' }] : [] };
      });
      return { items, next: items.length === 20 ? page + 1 : null };
    },
  },
];

SOURCES.forEach((s) => {
  s.kind = s.kind || 'livro';
  if (!s.preview && s.resolve && !['archive', 'archive-hq', 'openlibrary'].includes(s.id)) {
    s.preview = (item) => item.url ? cached('cover:' + item.url, async () => {
      const doc = await html(item.url);
      const cover = doc.querySelector('meta[property="og:image"], meta[name="og:image"]')?.getAttribute('content') || doc.querySelector('img[itemprop="image"], .book-cover img')?.getAttribute('src');
      return { cover: abs(cover, doc.sourceUrl || item.url) || null };
    }) : Promise.resolve({});
  }
  const fixed = { PT: 'pt', EN: 'en' }[s.lang];
  if (fixed) {
    const search = s.search;
    s.search = async (...a) => { const r = await search(...a); r.items.forEach((i) => { i.lang = i.lang || fixed; }); return r; };
  }
});
export const sourceLangs = (s) => (s.lang === 'Multi' ? ['pt', 'en'] : [{ PT: 'pt', EN: 'en' }[s.lang]]);
export const sourceById = (id) => SOURCES.find((s) => s.id === id);
export const resolveItem = async (src, item) => (item.files ? { files: item.files } : src.resolve(item));
