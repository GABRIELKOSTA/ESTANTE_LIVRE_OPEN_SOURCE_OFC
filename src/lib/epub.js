// Leitor de EPUB próprio: lê o ZIP, o OPF, o sumário e prepara capítulos
// para serem paginados em colunas CSS (o que permite a animação de folha real).
import JSZip from 'jszip';

const dirname = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
export function resolvePath(base, rel) {
  if (!rel) return base;
  if (/^[a-z]+:/i.test(rel)) return rel;
  try {
    const u = new URL(rel, 'http://epub/' + base);
    return decodeURIComponent(u.pathname.slice(1));
  } catch { return rel; }
}
const splitFrag = (h) => { const i = h.indexOf('#'); return i < 0 ? [h, ''] : [h.slice(0, i), h.slice(i + 1)]; };
const attrNS = (el, name) => el.getAttribute(name) || el.getAttributeNS('http://www.idpf.org/2007/ops', name.split(':').pop()) || '';

export async function openEpub(blob) {
  const zip = await JSZip.loadAsync(blob);
  const urls = new Map();
  const textCache = new Map();

  const file = (path) => zip.file(path) || zip.file(decodeURI(path)) || zip.file(encodeURI(path)) ||
    zip.file(new RegExp('^' + path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'))[0];
  const readText = async (path) => { const f = file(path); return f ? f.async('string') : ''; };
  const parseXml = (text, type = 'application/xml') => new DOMParser().parseFromString(text, type);

  const container = parseXml(await readText('META-INF/container.xml'));
  const opfPath = container.querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath) throw new Error('EPUB inválido: container.xml sem OPF');
  const opf = parseXml(await readText(opfPath));
  const opfDir = dirname(opfPath);

  const meta = (tag) => {
    const el = opf.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', tag)[0];
    return el?.textContent?.trim() || '';
  };

  const manifest = new Map();
  for (const it of opf.querySelectorAll('manifest > item')) {
    manifest.set(it.getAttribute('id'), {
      id: it.getAttribute('id'),
      href: resolvePath(opfDir, it.getAttribute('href')),
      type: it.getAttribute('media-type') || '',
      props: it.getAttribute('properties') || '',
    });
  }
  const spine = [];
  for (const ref of opf.querySelectorAll('spine > itemref')) {
    const it = manifest.get(ref.getAttribute('idref'));
    if (it) spine.push({ ...it, linear: ref.getAttribute('linear') !== 'no' });
  }
  const spineIndexOf = (path) => spine.findIndex((s) => s.href === path || s.href.toLowerCase() === path.toLowerCase());
  const weights = spine.map((s) => Math.max(500, file(s.href)?._data?.uncompressedSize || 4000));

  // --- capa
  function coverItem() {
    for (const it of manifest.values()) if (it.props.includes('cover-image')) return it;
    const metaCover = opf.querySelector('meta[name="cover"]')?.getAttribute('content');
    if (metaCover && manifest.get(metaCover)) return manifest.get(metaCover);
    for (const it of manifest.values()) if (it.type.startsWith('image/') && /cover/i.test(it.id + it.href)) return it;
    return null;
  }
  async function getCover() {
    let it = coverItem();
    if (!it && spine[0]) {
      const doc = parseXml(await readText(spine[0].href), 'text/html');
      const src = doc.querySelector('img')?.getAttribute('src') || doc.querySelector('image')?.getAttribute('xlink:href') || doc.querySelector('image')?.getAttribute('href');
      if (src) it = { href: resolvePath(spine[0].href, src), type: 'image/jpeg' };
    }
    if (!it) return null;
    const f = file(it.href);
    if (!f) return null;
    return new Blob([await f.async('uint8array')], { type: it.type || 'image/jpeg' });
  }

  // --- sumário (EPUB3 nav ou EPUB2 NCX)
  async function getToc() {
    const toc = [];
    const push = (label, href, depth) => {
      const [p, frag] = splitFrag(href);
      const idx = spineIndexOf(p);
      if (idx >= 0 && label) toc.push({ label: label.replace(/\s+/g, ' ').trim(), spineIndex: idx, fragment: frag, depth });
    };
    const navItem = [...manifest.values()].find((i) => i.props.split(/\s+/).includes('nav'));
    if (navItem) {
      const doc = parseXml(await readText(navItem.href), 'text/html');
      const navs = [...doc.querySelectorAll('nav')];
      const nav = navs.find((n) => attrNS(n, 'epub:type').includes('toc')) || navs[0];
      const walk = (ol, depth) => {
        for (const li of ol?.children || []) {
          if (li.tagName.toLowerCase() !== 'li') continue;
          const a = li.querySelector(':scope > a, :scope > span');
          if (a?.getAttribute('href')) push(a.textContent, resolvePath(navItem.href, a.getAttribute('href')), depth);
          walk(li.querySelector(':scope > ol'), depth + 1);
        }
      };
      if (nav) walk(nav.querySelector('ol'), 0);
    }
    if (!toc.length) {
      const ncxId = opf.querySelector('spine')?.getAttribute('toc');
      const ncx = manifest.get(ncxId) || [...manifest.values()].find((i) => i.type.includes('dtbncx'));
      if (ncx) {
        const doc = parseXml(await readText(ncx.href));
        const walk = (parent, depth) => {
          for (const np of parent.children) {
            if (np.localName !== 'navPoint') continue;
            const label = np.querySelector('navLabel > text')?.textContent;
            const src = np.querySelector('content')?.getAttribute('src');
            if (src) push(label, resolvePath(ncx.href, src), depth);
            walk(np, depth + 1);
          }
        };
        const map = doc.getElementsByTagName('navMap')[0];
        if (map) walk(map, 0);
      }
    }
    if (!toc.length) spine.forEach((s, i) => toc.push({ label: `Seção ${i + 1}`, spineIndex: i, fragment: '', depth: 0 }));
    return toc;
  }

  // --- recursos (imagens, fontes, css) viram blob: URLs
  async function blobUrl(path) {
    if (urls.has(path)) return urls.get(path);
    const f = file(path);
    if (!f) return '';
    const type = [...manifest.values()].find((m) => m.href === path)?.type || '';
    const u = URL.createObjectURL(new Blob([await f.async('uint8array')], type ? { type } : undefined));
    urls.set(path, u);
    return u;
  }
  async function rewriteCss(css, basePath, depth = 0) {
    let out = css;
    if (depth < 3) {
      const imports = [...css.matchAll(/@import\s+(?:url\()?["']?([^"')]+)["']?\)?[^;]*;/g)];
      for (const m of imports) {
        const p = resolvePath(basePath, m[1]);
        out = out.replace(m[0], await rewriteCss(await readText(p), p, depth + 1));
      }
    }
    const refs = [...out.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)];
    for (const m of refs) {
      if (/^(data|blob|https?):/i.test(m[1])) continue;
      const u = await blobUrl(resolvePath(basePath, m[1]));
      if (u) out = out.split(m[0]).join(`url("${u}")`);
    }
    // seletores de html/body passam a mirar o contêiner da página
    return out.replace(/(^|[\s,}>])(html|body)(?=[\s,{.#:[>])/gi, '$1.bk-body');
  }

  async function loadChapter(i) {
    const item = spine[i];
    const text = await readText(item.href);
    let doc = parseXml(text, 'application/xhtml+xml');
    if (doc.querySelector('parsererror') || !doc.body) doc = parseXml(text, 'text/html');
    doc.querySelectorAll('script,iframe,object,embed,form,input,button,textarea,select,meta,base,audio,video').forEach((n) => n.remove());
    let css = '';
    for (const l of doc.querySelectorAll('link')) {
      if ((l.getAttribute('rel') || '').includes('stylesheet') && l.getAttribute('href')) {
        const p = resolvePath(item.href, l.getAttribute('href'));
        css += (await rewriteCss(await readText(p), p)) + '\n';
      }
      l.remove();
    }
    for (const s of doc.querySelectorAll('style')) { css += (await rewriteCss(s.textContent, item.href)) + '\n'; s.remove(); }
    for (const el of doc.querySelectorAll('*')) {
      for (const a of [...el.attributes]) if (/^on/i.test(a.name)) el.removeAttribute(a.name);
    }
    for (const img of doc.querySelectorAll('img[src]')) img.setAttribute('src', await blobUrl(resolvePath(item.href, img.getAttribute('src'))));
    for (const img of doc.querySelectorAll('image')) {
      const h = img.getAttribute('xlink:href') || img.getAttribute('href');
      if (h) { const u = await blobUrl(resolvePath(item.href, h)); img.setAttribute('href', u); img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', u); }
    }
    for (const a of doc.querySelectorAll('a[href]')) {
      const h = a.getAttribute('href');
      if (/^(https?|mailto):/i.test(h)) a.setAttribute('data-ext', h);
      else {
        const [p, frag] = splitFrag(h);
        const target = p ? spineIndexOf(resolvePath(item.href, p)) : i;
        a.setAttribute('data-spine', String(target));
        a.setAttribute('data-frag', frag);
      }
      a.removeAttribute('href');
      a.setAttribute('role', 'link');
    }
    const body = doc.body || doc.documentElement;
    const node = document.importNode(body, true);
    const wrap = document.createElement('div');
    wrap.className = 'bk-body ' + (body.getAttribute('class') || '');
    while (node.firstChild) wrap.appendChild(node.firstChild);
    return { node: wrap, css };
  }

  async function chapterText(i) {
    if (textCache.has(i)) return textCache.get(i);
    const doc = parseXml(await readText(spine[i].href), 'text/html');
    const t = (doc.body?.textContent || '').replace(/\s+/g, ' ');
    textCache.set(i, t);
    return t;
  }

  return {
    title: meta('title'),
    author: meta('creator'),
    language: meta('language'),
    spine, weights, getCover, getToc, loadChapter, chapterText,
    destroy() { urls.forEach((u) => URL.revokeObjectURL(u)); urls.clear(); },
  };
}
