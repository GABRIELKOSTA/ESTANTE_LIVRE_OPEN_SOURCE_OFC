// HQs: CBZ (ZIP) e CBR (RAR). As páginas são extraídas sob demanda e viram blob: URLs.
import JSZip from 'jszip';

const IMG = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const mime = (n) => ({ png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp' }[n.split('.').pop().toLowerCase()] || 'image/jpeg');
const skip = (n) => /(^|\/)(__MACOSX|\.)/.test(n);

export async function archiveKind(blob) {
  const h = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  if (h[0] === 0x52 && h[1] === 0x61 && h[2] === 0x72 && h[3] === 0x21) return 'rar';
  if (h[0] === 0x50 && h[1] === 0x4b) return 'zip';
  if (h[0] === 0x37 && h[1] === 0x7a) return '7z';
  return null;
}

let unrarMod;
async function unrar() {
  if (!unrarMod) {
    unrarMod = (async () => {
      const [{ createExtractorFromData }, wasmUrl] = await Promise.all([
        import('node-unrar-js'),
        import('node-unrar-js/esm/js/unrar.wasm?url').then((m) => m.default),
      ]);
      const wasmBinary = await (await fetch(wasmUrl)).arrayBuffer();
      return { createExtractorFromData, wasmBinary };
    })();
  }
  return unrarMod;
}

function parseComicInfo(text) {
  try {
    const d = new DOMParser().parseFromString(text, 'application/xml');
    const g = (t) => d.getElementsByTagName(t)[0]?.textContent?.trim() || '';
    const series = g('Series'), num = g('Number'), title = g('Title');
    return {
      title: series ? `${series}${num ? ' #' + num : ''}${title && title !== series ? ' — ' + title : ''}` : title,
      author: g('Writer') || g('Penciller'),
    };
  } catch { return {}; }
}

export async function openComic(blob) {
  const kind = await archiveKind(blob);
  const urls = new Map();
  let names = [], read, info = {};

  if (kind === 'zip') {
    const zip = await JSZip.loadAsync(blob);
    names = Object.values(zip.files).filter((f) => !f.dir && IMG.test(f.name) && !skip(f.name)).map((f) => f.name).sort(natural);
    const ci = Object.keys(zip.files).find((n) => /(^|\/)comicinfo\.xml$/i.test(n));
    if (ci) info = parseComicInfo(await zip.file(ci).async('string'));
    read = async (n) => new Blob([await zip.file(n).async('uint8array')], { type: mime(n) });
  } else if (kind === 'rar') {
    const { createExtractorFromData, wasmBinary } = await unrar();
    const data = await blob.arrayBuffer();
    const ex = await createExtractorFromData({ data: data.slice(0), wasmBinary });
    const headers = [...ex.getFileList().fileHeaders];
    if (headers.some((h) => h.flags?.encrypted)) throw new Error('Este CBR tem senha.');
    names = headers.filter((h) => !h.flags?.directory && IMG.test(h.name) && !skip(h.name)).map((h) => h.name).sort(natural);
    const ci = headers.find((h) => /(^|\/)comicinfo\.xml$/i.test(h.name));
    // RAR costuma ser "sólido": extrair tudo numa passada só é muito mais rápido
    // (e a biblioteca não permite reaproveitar o mesmo buffer depois).
    const want = new Set([...names, ci?.name].filter(Boolean));
    const ex2 = await createExtractorFromData({ data: data.slice(0), wasmBinary });
    const blobs = new Map();
    for (const f of ex2.extract({ files: (h) => want.has(h.name) }).files) {
      if (!f.extraction) continue;
      if (ci && f.fileHeader.name === ci.name) info = parseComicInfo(new TextDecoder().decode(f.extraction));
      else blobs.set(f.fileHeader.name, new Blob([f.extraction], { type: mime(f.fileHeader.name) }));
    }
    names = names.filter((n) => blobs.has(n));
    read = async (n) => blobs.get(n);
  } else if (kind === '7z') {
    throw new Error('CB7 (7-Zip) ainda não é suportado. Converta para CBZ.');
  } else throw new Error('Arquivo de HQ inválido.');

  if (!names.length) throw new Error('Nenhuma imagem encontrada na HQ.');
  const pending = new Map();
  const pageUrl = (i) => {
    const n = names[i];
    if (urls.has(n)) return Promise.resolve(urls.get(n));
    if (!pending.has(n)) {
      pending.set(n, read(n).then((b) => { const u = URL.createObjectURL(b); urls.set(n, u); return u; }).finally(() => pending.delete(n)));
    }
    return pending.get(n);
  };
  return {
    kind, count: names.length, info, pageUrl,
    pageBlob: (i) => read(names[i]),
    destroy() { urls.forEach((u) => URL.revokeObjectURL(u)); urls.clear(); },
  };
}
