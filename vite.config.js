import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxy de desenvolvimento: permite baixar EPUB/PDF de sites sem CORS
// enquanto roda `npm run dev` no navegador. No APK, o download usa HTTP nativo.
function devProxy() {
  return {
    name: 'dev-download-proxy',
    configureServer(server) {
      server.middlewares.use('/__proxy', async (req, res) => {
        try {
          const target = new URL(req.url, 'http://local').searchParams.get('url');
          if (!/^https?:\/\//i.test(target || '')) { res.statusCode = 400; return res.end('url inválida'); }
          if (!['GET', 'POST'].includes(req.method)) { res.statusCode = 405; return res.end('Método não permitido'); }
          const chunks = [];
          let size = 0;
          if (req.method === 'POST') {
            for await (const chunk of req) {
              size += chunk.length;
              if (size > 1024 * 1024) { res.statusCode = 413; return res.end('Requisição muito grande'); }
              chunks.push(chunk);
            }
          }
          const r = await fetch(target, {
            method: req.method, redirect: 'follow', signal: AbortSignal.timeout(25000),
            headers: { 'User-Agent': 'EstanteLivre/1.0', ...(req.method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
            ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
          });
          res.statusCode = r.status;
          res.setHeader('Content-Type', r.headers.get('content-type') || 'application/octet-stream');
          res.setHeader('X-Final-URL', r.url);
          res.end(Buffer.from(await r.arrayBuffer()));
        } catch (e) { res.statusCode = 502; res.end(String(e)); }
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), devProxy()],
  build: { target: 'es2020', chunkSizeWarningLimit: 2000 },
});
