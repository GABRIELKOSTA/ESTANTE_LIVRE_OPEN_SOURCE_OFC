// Only HTTP(S) targets can be fetched or opened by a source adapter.
export function httpUrl(value, base) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const u = new URL(value, base);
    return /^https?:$/.test(u.protocol) ? u.href : '';
  } catch { return ''; }
}

export function decodeLabel(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

export const downloadKey = (file, item, source) => file.key || file.url || source.id + ':' + item.key + ':' + file.format;

export function fileFormat(value) {
  try { return decodeLabel(new URL(value).pathname).match(/\.(epub|pdf|cbr|cbz)$/i)?.[1].toLowerCase() || ''; }
  catch { return ''; }
}

// A download page may carry the actual file as an encoded query parameter.
export function directFile(value, base) {
  const url = httpUrl(value, base);
  if (!url) return null;
  const u = new URL(url);
  for (const key of ['pdf', 'epub', 'cbr', 'cbz', 'file', 'url', 'download']) {
    const nested = httpUrl(u.searchParams.get(key));
    if (nested && fileFormat(nested)) return { url: nested, format: fileFormat(nested) };
  }
  const format = fileFormat(url);
  return format ? { url, format } : null;
}

export async function assertBookFile(blob) {
  const header = String.fromCharCode(...new Uint8Array(await blob.slice(0, 512).arrayBuffer()));
  if (/^\s*(?:<!doctype\s+html|<html|<head|<body)/i.test(header)) throw new Error('O servidor devolveu uma página em vez do arquivo.');
  if (!/^(%PDF|PK|Rar!)/.test(header)) throw new Error('O link não retornou um EPUB, PDF, CBR ou CBZ válido.');
}
