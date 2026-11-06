import { getResource } from './net.js';
import { assertBookFile, directFile, httpUrl } from './download-links.js';
import { resolveHostedBook, supportsHostedDownload } from './hosted-download.js';

// Resolve páginas de download sem abrir o navegador nem importar HTML como livro.
export function downloadTargets(doc, base) {
  const candidates = [];
  const add = (value, rank) => {
    const url = httpUrl(value, base);
    if (url && /\/(?:register|login|upgrade|premium)(?:[/?#]|$)/i.test(new URL(url).pathname)) return;
    if (url && url !== base && !candidates.some((c) => c.url === url)) candidates.push({ url, rank });
  };
  for (const a of doc.getElementsByTagName('a')) {
    const href = a.getAttribute('href') || '';
    if (!href || href.startsWith('#')) continue;
    const file = directFile(href, base);
    if (file) add(file.url, 0);
    else if (a.hasAttribute('download') || /downloadbutton|download-link|downloadbtn/i.test(a.getAttribute('id') + ' ' + a.getAttribute('class')) || /download_token=|\/download\//i.test(href)) add(href, 1);
    else if (/^\s*(baixar(?:\s+agora|\s+arquivo|\s+livro)?|download(?:\s+now|\s+file)?)\s*$/i.test(a.textContent)) add(href, 2);
  }
  for (const tag of ['iframe', 'embed']) for (const node of doc.getElementsByTagName(tag)) {
    const file = directFile(node.getAttribute('src'), base);
    if (file) add(file.url, 0);
  }
  for (const meta of doc.getElementsByTagName('meta')) {
    if ((meta.getAttribute('http-equiv') || '').toLowerCase() !== 'refresh') continue;
    const content = meta.getAttribute('content') || '';
    const value = content.match(/url\s*=\s*["']?([^"']+)/i)?.[1];
    if (value) candidates.push({ url: httpUrl(value.trim(), base), rank: 1, delay: Math.min(600, Math.max(0, parseInt(content, 10) || 0)) });
  }
  return candidates.filter((c) => c.url).sort((a, b) => a.rank - b.rank);
}

export function createBookDownloader({ fetchResource = getResource, parse = (s) => new DOMParser().parseFromString(s, 'text/html'), wait = (ms) => new Promise((r) => setTimeout(r, ms)), resolveHosted = resolveHostedBook } = {}) {
  return async (url, onProgress, options = {}) => {
    const pending = [{ url, referer: options.referer }], visited = new Set();
    let reason = '';
    for (let attempt = 0; pending.length && attempt < 6; attempt++) {
      const next = pending.shift();
      if (visited.has(next.url)) continue;
      visited.add(next.url);
      try {
        if (next.delay) {
          for (let remaining = next.delay; remaining > 0; remaining--) {
            onProgress?.(-1, `Aguardando liberação: ${remaining}s`, { phase: 'waiting', remainingSeconds: remaining });
            await wait(1000);
          }
        }
        onProgress?.(-1, attempt ? 'Resolvendo o download…' : 'Conectando…', { phase: 'preparing' });
        const result = await fetchResource(next.url, onProgress, { referer: next.referer });
        try { await assertBookFile(result.blob); return result.blob; } catch { /* inspeciona apenas páginas HTML abaixo */ }
        const head = await result.blob.slice(0, 1024).text();
        if (!/^\s*(?:\uFEFF)?\s*</.test(head)) throw new Error('O servidor não retornou um arquivo de livro ou HQ.');
        const content = await result.blob.text();
        const base = result.url || next.url;
        const targets = downloadTargets(parse(content), base).filter((c) => !visited.has(c.url));
        if (supportsHostedDownload(base) && (!targets.length || /captcha|cf-chl-|challenge-platform|just a moment/i.test(content))) return await resolveHosted(base, onProgress);
        if (/captcha|cf-chl-|challenge-platform|just a moment/i.test(content)) throw new Error('O hospedador exige uma verificação e não liberou o arquivo para download direto.');
        if (!targets.length) throw new Error('O hospedador não disponibilizou um arquivo para download direto neste item.');
        pending.unshift(...targets.map((c) => ({ ...c, referer: base })));
      } catch (e) { reason = e.message; }
    }
    throw new Error(reason || 'Não foi possível resolver o download deste item.');
  };
}
export const downloadBook = createBookDownloader();
