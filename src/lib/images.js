import { getBlob } from './net.js';

export async function validateImage(blob) {
  if (!blob?.size) throw new Error('Imagem vazia.');
  if (typeof createImageBitmap === 'function') {
    let bitmap;
    try { bitmap = await createImageBitmap(blob); if (!bitmap.width || !bitmap.height) throw new Error(); }
    catch { throw new Error('Não foi possível abrir a imagem recebida do servidor.'); }
    finally { bitmap?.close(); }
  } else if (typeof Image !== 'undefined') {
    const url = URL.createObjectURL(blob);
    try {
      await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => image.naturalWidth ? resolve() : reject(new Error('Imagem sem conteúdo.'));
        image.onerror = () => reject(new Error('Não foi possível abrir a imagem recebida do servidor.'));
        image.src = url;
      });
    } finally { URL.revokeObjectURL(url); }
  }
  return blob;
}

// Capas passam pelo mesmo HTTP nativo dos arquivos, em vez de depender do
// carregador de imagens do WebView (CORS, cookies e bloqueios de referer).
export function createCoverCache({ download = getBlob, limit = 80, concurrency = 3 } = {}) {
  const cache = new Map(), queue = [];
  let active = 0;
  const pump = () => {
    while (active < concurrency && queue.length) {
      const task = queue.shift(); active++;
      task().finally(() => { active--; pump(); });
    }
  };
  return {
    load(url, referer) {
      const key = `${referer || ''}|${url}`;
      if (cache.has(key)) return cache.get(key);
      const promise = new Promise((resolve, reject) => {
        queue.push(async () => {
          try { const blob = await download(url, undefined, { referer }); await validateImage(blob); resolve(blob); }
          catch (e) { cache.delete(key); reject(e); }
        });
        pump();
      });
      cache.set(key, promise);
      if (cache.size > limit) cache.delete(cache.keys().next().value);
      return promise;
    },
  };
}
export const coverCache = createCoverCache();

let previewActive = 0;
const previews = [];
function pumpPreviews() {
  while (previewActive < 3 && previews.length) {
    const task = previews.shift(); previewActive++;
    Promise.resolve().then(task.run).then(task.resolve, task.reject).finally(() => { previewActive--; pumpPreviews(); });
  }
}
export function previewCover(source, item) {
  return new Promise((resolve, reject) => {
    previews.push({ run: () => source?.preview?.(item), resolve, reject });
    pumpPreviews();
  });
}
