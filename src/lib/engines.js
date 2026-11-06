// Motores de leitura com a mesma interface para EPUB e PDF:
//  canStep(dir) · step(dir) · snapshot() · goTo(loc) · goToPercent(x) · relayout(prefs)
//  info() · location() · toc · search(q, onProgress, signal) · handleClick(e) · destroy()
import { openEpub } from './epub.js';
import { openPdf, renderPage, pageText, pdfOutline, closePdf } from './pdf.js';
import { openComic } from './comic.js';

export const fold = (s = '') => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const FONTS = {
  original: '',
  literata: "'Literata', Georgia, serif",
  serif: "Georgia, 'Times New Roman', serif",
  sans: "'Outfit', system-ui, sans-serif",
  dyslexic: "Verdana, Tahoma, sans-serif",
};
export const MARGINS = { estreita: 14, media: 26, larga: 44 };

function waitImages(root, timeout = 1500) {
  const imgs = [...root.querySelectorAll('img')].filter((i) => !i.complete);
  if (!imgs.length) return Promise.resolve();
  return Promise.race([
    Promise.all(imgs.map((i) => new Promise((r) => { i.onload = i.onerror = r; }))),
    new Promise((r) => setTimeout(r, timeout)),
  ]);
}

// ---------------------------------------------------------------- EPUB
export async function createEpubEngine({ host, blob, prefs: initialPrefs, onExternal }) {
  const book = await openEpub(blob);
  const toc = await book.getToc();
  const total = book.weights.reduce((a, b) => a + b, 0);
  const cum = []; let acc = 0;
  for (const w of book.weights) { cum.push(acc); acc += w; }
  const last = book.spine.length - 1;

  const pageEl = document.createElement('div');
  pageEl.className = 'epub-page';
  host.appendChild(pageEl);
  const root = pageEl.attachShadow({ mode: 'open' });

  let prefs = initialPrefs;
  let i = 0, p = 0, n = 1, W = 300, H = 400, G = 40;
  let cols = null;
  const cache = new Map();

  const chapter = (idx) => {
    if (!cache.has(idx)) {
      const pr = book.loadChapter(idx).catch((e) => { cache.delete(idx); throw e; });
      cache.set(idx, pr);
      if (cache.size > 8) cache.delete(cache.keys().next().value);
    }
    return cache.get(idx);
  };

  function css() {
    const m = MARGINS[prefs.margin] ?? 26;
    const font = FONTS[prefs.font] || '';
    const { fg, link } = prefs.colors;
    return `
      :host { all: initial; }
      .vp { position: absolute; left: ${m}px; top: 30px; width: ${W}px; height: ${H}px; overflow: hidden; }
      .cols { width: ${W}px; height: ${H}px; column-width: ${W}px; column-gap: ${G}px; column-fill: auto; will-change: transform; }
      .bk-body { margin: 0 !important; padding: 0 !important; background: transparent !important; font-size: ${prefs.fontSize}px !important; line-height: ${prefs.lineHeight} !important;
        color: ${fg}; text-align: ${prefs.justify ? 'justify' : 'start'}; hyphens: auto; -webkit-hyphens: auto; overflow-wrap: break-word;
        ${font ? `font-family: ${font} !important;` : "font-family: 'Literata', Georgia, serif;"} width: auto !important; height: auto !important; max-width: none !important; }
      .bk-body * { max-width: 100%; box-sizing: border-box; color: ${fg} !important; background-color: transparent !important; border-color: color-mix(in srgb, ${fg} 25%, transparent) !important; }
      ${font ? `.bk-body * { font-family: ${font} !important; }` : ''}
      .bk-body p, .bk-body div, .bk-body li { line-height: inherit !important; }
      .bk-body a, .bk-body a * { color: ${link} !important; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
      .bk-body img, .bk-body svg { max-width: 100% !important; max-height: ${H - 4}px !important; height: auto; object-fit: contain; break-inside: avoid; }
      .bk-body svg { height: auto !important; }
      .bk-body h1, .bk-body h2, .bk-body h3, .bk-body h4 { break-after: avoid; line-height: 1.25 !important; }
      .bk-body pre { white-space: pre-wrap; }
      .bk-body table { width: 100% !important; }
      mark.hl { background: #ffd23f !important; color: #000 !important; border-radius: 2px; }
      .bk-body > *:first-child { margin-top: 0 !important; }
    `;
  }

  function measure() {
    const r = host.getBoundingClientRect();
    const m = MARGINS[prefs.margin] ?? 26;
    W = Math.max(160, Math.floor(r.width - 2 * m));
    H = Math.max(200, Math.floor(r.height - 30 - 34));
    G = 2 * m;
  }

  const setTransform = () => { if (cols) cols.style.transform = `translateX(${-p * (W + G)}px)`; };

  function findHit(q, k) {
    const t = fold(q);
    const walker = document.createTreeWalker(cols, NodeFilter.SHOW_TEXT);
    let count = 0, node;
    while ((node = walker.nextNode())) {
      const f = fold(node.nodeValue);
      let idx = f.indexOf(t);
      while (idx >= 0) {
        if (count === k) {
          const range = document.createRange();
          range.setStart(node, idx); range.setEnd(node, Math.min(node.length, idx + q.length));
          const mark = document.createElement('mark'); mark.className = 'hl';
          try { range.surroundContents(mark); } catch { return range.getBoundingClientRect(); }
          return mark.getBoundingClientRect();
        }
        count++; idx = f.indexOf(t, idx + t.length);
      }
    }
    return null;
  }

  async function render(idx, opt = {}) {
    const ch = await chapter(idx);
    measure();
    const style = document.createElement('style'); style.textContent = ch.css;
    const base = document.createElement('style'); base.textContent = css();
    const vp = document.createElement('div'); vp.className = 'vp';
    cols = document.createElement('div'); cols.className = 'cols';
    cols.appendChild(ch.node.cloneNode(true));
    vp.appendChild(cols);
    root.replaceChildren(style, base, vp);
    await waitImages(cols);
    if (document.fonts?.ready) await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 800))]);
    i = idx;
    n = Math.max(1, Math.round((cols.scrollWidth + G) / (W + G)));
    let target = 0;
    if (opt.page === 'last') target = n - 1;
    else if (opt.frac != null) target = Math.round(opt.frac * n);
    if (opt.frag) {
      const el = root.getElementById(opt.frag) || root.querySelector(`[name="${CSS.escape(opt.frag)}"]`);
      if (el) target = Math.floor((el.getBoundingClientRect().left - cols.getBoundingClientRect().left + 2) / (W + G));
    }
    if (opt.hit) {
      const rect = findHit(opt.hit.q, opt.hit.k);
      if (rect) target = Math.floor((rect.left - cols.getBoundingClientRect().left + 2) / (W + G));
    }
    p = clamp(target, 0, n - 1);
    setTransform();
  }

  const tocLabel = (idx) => {
    let label = '';
    for (const t of toc) if (t.spineIndex <= idx) label = t.label; else if (label) break;
    return label || book.title;
  };

  return {
    kind: 'epub',
    toc,
    title: book.title,
    async start(loc) {
      if (loc?.i != null) await render(clamp(loc.i, 0, last), { frac: loc.f || 0 });
      else await render(0);
    },
    canStep: (d) => (d > 0 ? p < n - 1 || i < last : p > 0 || i > 0),
    async step(d) {
      if (d > 0) { if (p < n - 1) { p++; setTransform(); } else if (i < last) await render(i + 1, { page: 0 }); }
      else if (p > 0) { p--; setTransform(); } else if (i > 0) await render(i - 1, { page: 'last' });
    },
    snapshot() {
      const d = document.createElement('div');
      d.className = 'epub-page snap';
      const sr = d.attachShadow({ mode: 'open' });
      for (const c of root.children) sr.appendChild(c.cloneNode(true));
      return d;
    },
    goTo: (loc) => render(clamp(loc.i, 0, last), loc.frag != null ? { frag: loc.frag } : loc.hit ? { hit: loc.hit } : { frac: loc.f || 0 }),
    goToPercent(x) {
      const t = clamp(x, 0, 0.9999) * total;
      let idx = 0;
      while (idx < last && cum[idx + 1] <= t) idx++;
      return render(idx, { frac: (t - cum[idx]) / book.weights[idx] });
    },
    relayout(next) { prefs = next; return render(i, { frac: n > 1 ? p / n : 0 }); },
    location: () => ({ i, f: n > 1 ? p / n : 0 }),
    sameSpot: (a) => a && a.i === i && Math.round((a.f || 0) * n) === p,
    progress: () => (cum[i] + book.weights[i] * ((p + 1) / n)) / total,
    info: () => ({ label: tocLabel(i), page: p + 1, pages: n, left: n - p - 1, progress: (cum[i] + book.weights[i] * ((p + 1) / n)) / total }),
    tocActive: (t) => t.spineIndex === i,
    labelFor: (loc) => tocLabel(loc.i),
    async search(q, onProgress, signal) {
      const t = fold(q.trim());
      const out = [];
      if (t.length < 2) return out;
      for (let idx = 0; idx <= last && out.length < 300; idx++) {
        if (signal?.aborted) break;
        const raw = await book.chapterText(idx);
        const f = fold(raw);
        let at = f.indexOf(t), k = 0;
        while (at >= 0 && out.length < 300) {
          out.push({ loc: { i: idx, hit: { q: q.trim(), k } }, label: tocLabel(idx), snippet: raw.slice(Math.max(0, at - 50), at + t.length + 60), at: at - Math.max(0, at - 50), len: t.length });
          k++; at = f.indexOf(t, at + t.length);
        }
        onProgress?.((idx + 1) / (last + 1), [...out]);
      }
      return out;
    },
    handleClick(e) {
      const a = e.composedPath().find((el) => el.dataset && (el.dataset.spine != null || el.dataset.ext));
      if (!a) return false;
      if (a.dataset.ext) onExternal?.(a.dataset.ext);
      else if (+a.dataset.spine >= 0) return { i: +a.dataset.spine, frag: a.dataset.frag || '' };
      return true;
    },
    destroy() { pageEl.remove(); book.destroy(); },
  };
}

// ---------------------------------------------------------------- PDF
export async function createPdfEngine({ host, blob, prefs: initialPrefs }) {
  const doc = await openPdf(blob);
  const total = doc.numPages;
  const toc = (await pdfOutline(doc)).map((t) => ({ ...t, spineIndex: t.page }));
  let prefs = initialPrefs;
  let num = 1;
  const cache = new Map();

  const pageEl = document.createElement('div');
  pageEl.className = 'pdf-page';
  host.appendChild(pageEl);

  const key = (k) => { const r = host.getBoundingClientRect(); return `${k}@${Math.round(r.width)}x${Math.round(r.height)}`; };
  function canvasFor(k) {
    const id = key(k);
    if (!cache.has(id)) {
      const r = host.getBoundingClientRect();
      const pr = renderPage(doc, k, r.width - 12, r.height - 12).catch((e) => { cache.delete(id); throw e; });
      cache.set(id, pr);
      if (cache.size > 10) cache.delete(cache.keys().next().value);
    }
    return cache.get(id);
  }
  async function show(k) {
    k = clamp(k, 1, total);
    const c = await canvasFor(k);
    num = k;
    pageEl.replaceChildren(c);
    if (k < total) canvasFor(k + 1).catch(() => {});
    if (k > 1) canvasFor(k - 1).catch(() => {});
  }
  const tocLabel = (k) => { let l = ''; for (const t of toc) if (t.page <= k) l = t.label; return l; };

  return {
    kind: 'pdf',
    toc,
    zoomable: true,
    zoomEl: () => pageEl.firstElementChild,
    // re-renderiza a página atual com mais pixels para o zoom ficar nítido
    async sharpen(scale) {
      if (scale < 1.3) return;
      const r = host.getBoundingClientRect();
      const at = num;
      const c = await renderPage(doc, at, r.width - 12, r.height - 12, 1, Math.min(scale, 4)).catch(() => null);
      const old = pageEl.firstElementChild;
      if (c && at === num && old) { c.style.transform = old.style.transform; c.style.transformOrigin = old.style.transformOrigin; old.replaceWith(c); }
    },
    start: (loc) => show(loc?.page || 1),
    canStep: (d) => (d > 0 ? num < total : num > 1),
    step: (d) => show(num + d),
    snapshot() {
      const d = document.createElement('div');
      d.className = 'pdf-page snap';
      const src = pageEl.querySelector('canvas');
      if (src) {
        const c = document.createElement('canvas');
        c.width = src.width; c.height = src.height; c.style.cssText = src.style.cssText;
        c.getContext('2d').drawImage(src, 0, 0);
        d.appendChild(c);
      }
      return d;
    },
    goTo: (loc) => show(loc.page || loc.i || 1),
    goToPercent: (x) => show(Math.round(1 + x * (total - 1))),
    relayout(next) { prefs = next; cache.clear(); return show(num); },
    location: () => ({ page: num }),
    sameSpot: (a) => a && a.page === num,
    progress: () => num / total,
    info: () => ({ label: tocLabel(num), page: num, pages: total, left: total - num, progress: num / total, pdf: true }),
    tocActive: (t) => t.page <= num && !toc.some((o) => o.page > t.page && o.page <= num),
    labelFor: (loc) => tocLabel(loc.page) || `Página ${loc.page}`,
    async search(q, onProgress, signal) {
      const t = fold(q.trim());
      const out = [];
      if (t.length < 2) return out;
      for (let k = 1; k <= total && out.length < 300; k++) {
        if (signal?.aborted) break;
        const raw = await pageText(doc, k).catch(() => '');
        const f = fold(raw);
        let at = f.indexOf(t);
        while (at >= 0 && out.length < 300) {
          out.push({ loc: { page: k }, label: `Página ${k}`, snippet: raw.slice(Math.max(0, at - 50), at + t.length + 60), at: at - Math.max(0, at - 50), len: t.length });
          at = f.indexOf(t, at + t.length);
        }
        if (k % 5 === 0 || k === total) onProgress?.(k / total, [...out]);
      }
      return out;
    },
    handleClick: () => false,
    destroy() { pageEl.remove(); closePdf(doc); },
  };
}

// ---------------------------------------------------------------- HQ (CBZ / CBR)
export async function createComicEngine({ host, blob, prefs: initialPrefs }) {
  const comic = await openComic(blob);
  const total = comic.count;
  let prefs = initialPrefs;
  let num = 1;

  const pageEl = document.createElement('div');
  pageEl.className = 'comic-page';
  host.appendChild(pageEl);

  const loadImg = async (k) => {
    const img = new Image();
    img.className = 'comic-img';
    img.decoding = 'async';
    img.draggable = false;
    img.alt = `Página ${k}`;
    img.src = await comic.pageUrl(k - 1);
    try { await img.decode(); if (!img.naturalWidth) throw new Error(); }
    catch { throw new Error(`Não foi possível abrir a página ${k} da HQ. O arquivo pode conter uma imagem incompleta ou incompatível.`); }
    return img;
  };
  async function show(k) {
    k = clamp(k, 1, total);
    const img = await loadImg(k);
    num = k;
    pageEl.classList.toggle('rtl', !!prefs.comicRtl);
    pageEl.replaceChildren(img);
    for (const n of [k + 1, k + 2, k - 1]) if (n >= 1 && n <= total) comic.pageUrl(n - 1).catch(() => {});
  }
  // mangá: avançar pela esquerda
  const dirOf = (d) => (prefs.comicRtl ? -d : d);

  return {
    kind: 'comic',
    toc: [],
    zoomable: true,
    zoomEl: () => pageEl.firstElementChild,
    flipDir: (d) => (prefs.comicRtl ? -d : d),
    start: (loc) => show(loc?.page || 1),
    canStep: (d) => (dirOf(d) > 0 ? num < total : num > 1),
    step: (d) => show(num + dirOf(d)),
    snapshot() {
      const d = document.createElement('div');
      d.className = 'comic-page snap';
      const src = pageEl.firstElementChild;
      if (src) d.appendChild(src.cloneNode(true));
      return d;
    },
    goTo: (loc) => show(loc.page || 1),
    goToPercent: (x) => show(Math.round(1 + x * (total - 1))),
    relayout(next) { prefs = next; return show(num); },
    location: () => ({ page: num }),
    sameSpot: (a) => a && a.page === num,
    progress: () => num / total,
    info: () => ({ label: `Página ${num} de ${total}`, page: num, pages: total, left: total - num, progress: num / total, pdf: true }),
    tocActive: () => false,
    labelFor: (loc) => `Página ${loc.page}`,
    async search() { return []; },
    handleClick: () => false,
    destroy() { pageEl.remove(); comic.destroy(); },
  };
}
