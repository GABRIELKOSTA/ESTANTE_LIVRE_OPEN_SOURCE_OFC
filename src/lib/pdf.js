import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export async function openPdf(blob) {
  const data = new Uint8Array(await blob.arrayBuffer());
  const task = pdfjs.getDocument({ data, isEvalSupported: false });
  const doc = await task.promise;
  doc.__task = task;
  return doc;
}

export function closePdf(doc) {
  try { (typeof doc.destroy === 'function' ? doc.destroy() : doc.__task?.destroy())?.catch?.(() => {}); } catch { /* já fechado */ }
}

// Renderiza uma página num canvas que cabe em (maxW x maxH) CSS px.
// `quality` > 1 gera mais pixels no mesmo tamanho na tela (nitidez ao dar zoom com pinça).
export async function renderPage(doc, num, maxW, maxH, zoom = 1, quality = 1) {
  const page = await doc.getPage(num);
  const base = page.getViewport({ scale: 1 });
  const fit = Math.min(maxW / base.width, maxH / base.height) * zoom;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  let px = fit * dpr * quality;
  const maxPixels = 14e6; // limite de memória do canvas no celular
  if (base.width * base.height * px * px > maxPixels) px = Math.sqrt(maxPixels / (base.width * base.height));
  const vp = page.getViewport({ scale: px });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  canvas.style.width = Math.floor(base.width * fit) + 'px';
  canvas.style.height = Math.floor(base.height * fit) + 'px';
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, canvas }).promise;
  return canvas;
}

export async function pdfCover(doc) {
  const c = await renderPage(doc, 1, 420, 640);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
}

export async function pageText(doc, num) {
  const page = await doc.getPage(num);
  const tc = await page.getTextContent();
  return tc.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ');
}

export async function pdfOutline(doc) {
  const out = [];
  const outline = await doc.getOutline().catch(() => null);
  const walk = async (items, depth) => {
    for (const it of items || []) {
      try {
        let dest = it.dest;
        if (typeof dest === 'string') dest = await doc.getDestination(dest);
        if (Array.isArray(dest) && dest[0]) {
          const idx = typeof dest[0] === 'number' ? dest[0] : await doc.getPageIndex(dest[0]);
          out.push({ label: it.title, page: idx + 1, depth });
        }
      } catch { /* destino inválido */ }
      await walk(it.items, depth + 1);
    }
  };
  await walk(outline, 0);
  return out;
}
