import { Capacitor, registerPlugin } from '@capacitor/core';
import { getResource } from './net.js';
import { assertBookFile, httpUrl } from './download-links.js';

const HostedDownload = registerPlugin('HostedDownload');
export function supportsHostedDownload(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && /(^|\.)(asdocs\.net|mediafire\.com)$/i.test(u.hostname); }
  catch { return false; }
}

export function createHostedResolver({ plugin = HostedDownload, native = () => Capacitor.isNativePlatform(), fetchResource = getResource } = {}) {
  let tail = Promise.resolve(), pending = 0;
  const resolve = async (url, onProgress) => {
    if (!supportsHostedDownload(url)) throw new Error('Este hospedador ainda não tem resolução dinâmica integrada.');
    if (!native()) throw new Error('Este hospedador precisa do resolvedor Android. Use o APK atualizado para baixar dentro do app.');
    const requestId = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    onProgress?.(-1, 'Preparando o download gratuito no hospedador…');
    const listener = await plugin.addListener('progress', (event) => {
      if (event.requestId === requestId) onProgress?.(-1, event.stage, {
        phase: event.kind === 'verification' ? 'verification' : event.kind === 'waiting' ? 'waiting' : event.kind ? 'preparing' : undefined,
        remainingSeconds: event.remainingSeconds,
      });
    });
    try {
      const result = await plugin.resolve({ url, requestId });
      const target = httpUrl(result.url);
      if (!target || !target.startsWith('https:')) throw new Error('O hospedador retornou um endereço inválido.');
      onProgress?.(-1, 'Baixando o arquivo liberado…', { phase: 'downloading' });
      const resource = await fetchResource(target, onProgress, { referer: result.referer || url, headers: result.headers || {} });
      await assertBookFile(resource.blob);
      return resource.blob;
    } finally { await listener.remove(); }
  };
  return (url, onProgress) => {
    if (pending) onProgress?.(-1, 'Aguardando preparação de outro download…');
    pending++;
    const task = tail.then(() => resolve(url, onProgress)).finally(() => { pending--; });
    tail = task.catch(() => {});
    return task;
  };
}
export const resolveHostedBook = createHostedResolver();
