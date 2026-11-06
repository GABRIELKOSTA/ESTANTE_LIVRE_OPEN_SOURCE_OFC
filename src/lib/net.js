// Rede: no APK usa HTTP nativo (sem bloqueio de CORS); no navegador usa fetch,
// e em desenvolvimento cai para o proxy do Vite quando o site bloqueia CORS.
import { Capacitor, CapacitorHttp } from '@capacitor/core';

const isNative = () => Capacitor.isNativePlatform();

export const requestHeaders = (referer) => ({ Accept: '*/*', ...(typeof navigator !== 'undefined' && navigator.userAgent ? { 'User-Agent': navigator.userAgent } : {}), ...(referer ? { Referer: referer } : {}) });

export function nativeBlob(data, type) {
  if (typeof data !== 'string') throw new Error('O servidor retornou dados em vez de um arquivo.');
  // Alguns servidores retornam base64 com quebras de linha ou prefixo data:.
  const b64 = data.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  let bin;
  try { bin = atob(b64); } catch { throw new Error('O download retornou uma resposta inválida.'); }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

async function webFetch(url, options = {}) {
  let r;
  try {
    r = await fetch(url, { ...options, redirect: 'follow', signal: AbortSignal.timeout(25000) });
  } catch (e) {
    if (import.meta.env?.DEV) r = await fetch('/__proxy?url=' + encodeURIComponent(url), { ...options, signal: AbortSignal.timeout(30000) });
    else throw new Error('Não foi possível acessar o servidor. Verifique a conexão; no navegador, o site também pode bloquear o acesso por CORS.');
  }
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r;
}

export async function postJson(url, data, options = {}) {
  if (isNative()) {
    const r = await CapacitorHttp.post({ url, data, headers: { ...requestHeaders(options.referer), 'Content-Type': 'application/json', ...(options.origin ? { Origin: options.origin } : {}) }, responseType: 'json', connectTimeout: 15000, readTimeout: 25000 });
    if (r.status < 200 || r.status >= 300) throw new Error('HTTP ' + r.status);
    return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
  }
  return (await webFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })).json();
}

export async function getPage(url, options = {}) {
  if (isNative()) {
    const r = await CapacitorHttp.get({ url, headers: requestHeaders(options.referer), responseType: 'text', connectTimeout: 15000, readTimeout: 25000 });
    if (r.status >= 400) throw new Error('HTTP ' + r.status);
    return { text: typeof r.data === 'string' ? r.data : JSON.stringify(r.data), url: r.url || url };
  }
  const r = await webFetch(url);
  return { text: await r.text(), url: r.headers.get('X-Final-URL') || (r.url.includes('/__proxy?') ? url : r.url) || url };
}

export async function getText(url) { return (await getPage(url)).text; }

export async function nativeResource(url, onProgress, options = {}, request = (o) => CapacitorHttp.get(o)) {
    onProgress?.(-1);
    let target = url, referer = options.referer;
    const initialOrigin = new URL(url).origin;
    const visited = new Set();
    for (let count = 0; count < 6; count++) {
      if (visited.has(target)) throw new Error('O servidor retornou um ciclo de redirecionamentos.');
      visited.add(target);
      const extraHeaders = Object.fromEntries(Object.entries(options.headers || {}).filter(([name]) =>
        /^(user-agent|cookie)$/i.test(name) && (name.toLowerCase() !== 'cookie' || new URL(target).origin === initialOrigin)));
      const r = await request({ url: target, headers: { ...requestHeaders(referer), ...extraHeaders }, disableRedirects: true, responseType: 'arraybuffer', connectTimeout: 15000, readTimeout: 60000 });
      const headers = Object.fromEntries(Object.entries(r.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
      if ([301, 302, 303, 307, 308].includes(r.status) && headers.location) {
        const next = new URL(headers.location, target);
        if (!/^https?:$/.test(next.protocol)) throw new Error('O servidor retornou um endereço inválido.');
        referer = target; target = next.href; continue;
      }
      if (r.status < 200 || r.status >= 300) throw new Error('HTTP ' + r.status);
      return { blob: nativeBlob(r.data, headers['content-type'] || 'application/octet-stream'), url: r.url || target, headers };
    }
    throw new Error('O servidor retornou redirecionamentos demais.');
}

export async function getResource(url, onProgress, options = {}) {
  if (isNative()) return nativeResource(url, onProgress, options);
  const r = await webFetch(url);
  const total = +r.headers.get('content-length') || 0;
  const meta = { url: r.headers.get('X-Final-URL') || r.url || url, headers: Object.fromEntries(r.headers.entries()) };
  if (!r.body || !total || !onProgress) return { ...meta, blob: await r.blob() };
  const reader = r.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    onProgress(got / total);
  }
  return { ...meta, blob: new Blob(chunks, { type: r.headers.get('content-type') || '' }) };
}

export async function getBlob(url, onProgress, options) { return (await getResource(url, onProgress, options)).blob; }

export function openExternal(url) {
  window.open(url, '_blank', 'noopener');
}
