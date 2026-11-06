import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
import { nativeResource } from './net.js';
import { assertBookFile } from './download-links.js';

const WifiShare = registerPlugin('WifiShare');
export const canShareWifi = () => Capacitor.isNativePlatform();

export function parseWifiLink(value) {
  const link = new URL(value);
  if (link.protocol !== 'estantelivre:' || link.hostname !== 'receive' || (link.pathname && link.pathname !== '/')) throw new Error('Link de recebimento inválido.');
  const url = new URL(link.searchParams.get('url'));
  const parts = url.hostname.split('.').map(Number);
  const local = parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255) &&
    (parts[0] === 10 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31));
  const format = url.pathname.match(/^\/s\/[a-f0-9]{32}\/file\.(epub|pdf|cbz|cbr|cb7)$/)?.[1];
  if (url.protocol !== 'http:' || !local || !url.port || url.username || url.password || url.search || url.hash || !format) throw new Error('O link precisa apontar para um compartilhamento na rede Wi-Fi local.');
  return { url: url.href, format, title: (link.searchParams.get('title') || 'Livro recebido').slice(0, 500), author: (link.searchParams.get('author') || '').slice(0, 500) };
}

export function createWifiSender({ plugin = WifiShare, native = canShareWifi, encode = btoa } = {}) {
  let session, stopped = false;
  const stop = async () => { stopped = true; if (session) await plugin.stop({ sessionId: session }); };
  return {
    stop,
    status: () => session ? plugin.status({ sessionId: session }) : Promise.resolve({ active: false }),
    async start(book, blob, onProgress) {
      if (!native()) throw new Error('O envio por Wi-Fi está disponível no aplicativo Android.');
      if (!blob?.size) throw new Error('O arquivo deste livro não está salvo no aparelho.');
      if (session || stopped) throw new Error('Abra novamente a tela de compartilhamento.');
      const result = await plugin.begin({ title: book.title, author: book.author || '', format: book.format, size: blob.size });
      session = result.sessionId;
      try {
        for (let offset = 0; offset < blob.size; offset += 196608) {
          if (stopped) throw new Error('Envio encerrado.');
          const bytes = new Uint8Array(await blob.slice(offset, offset + 196608).arrayBuffer());
          let binary = '';
          for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
          await plugin.append({ sessionId: session, offset, data: encode(binary) });
          onProgress?.(Math.min(1, (offset + bytes.length) / blob.size));
        }
        if (stopped) throw new Error('Envio encerrado.');
        const share = await plugin.finish({ sessionId: session });
        if (stopped) throw new Error('Envio encerrado.');
        return share;
      } catch (error) { await plugin.stop({ sessionId: session }).catch(() => {}); throw error; }
    },
  };
}

export function createWifiReceiver({ request = o => CapacitorHttp.get(o), importBlob, onProgress = () => {} } = {}) {
  const receiving = new Map();
  return (value) => {
    const meta = parseWifiLink(value);
    if (receiving.has(meta.url)) return receiving.get(meta.url);
    const task = (async () => {
      onProgress('Recebendo “' + meta.title + '” por Wi-Fi…');
      const resource = await nativeResource(meta.url, undefined, {}, options => {
        // A shared book is served directly. Do not follow redirects off this URL.
        if (options.url !== meta.url) throw new Error('O compartilhamento mudou de endereço. Leia o QR code novamente.');
        return request(options);
      });
      if (meta.format === 'cb7') {
        const signature = new Uint8Array(await resource.blob.slice(0, 6).arrayBuffer());
        if (signature.join(',') !== '55,122,188,175,39,28') throw new Error('O arquivo recebido não é uma HQ válida.');
      } else await assertBookFile(resource.blob);
      onProgress('Adicionando à estante…');
      return importBlob(resource.blob, { name: `${meta.title}.${meta.format}`, title: meta.title, author: meta.author });
    })();
    receiving.set(meta.url, task);
    // Keep successful sessions deduplicated while the app is open; allow retry after failure.
    task.catch(() => { receiving.delete(meta.url); });
    return task;
  };
}
