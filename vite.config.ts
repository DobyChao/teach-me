import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs/promises';
import path from 'node:path';
export default defineConfig({
  plugins: [
    react(),
    {
      // Excalidraw 0.18.1 appends a CDN font candidate even when a local asset path
      // is configured. Keep its fallback local as well; CSP still blocks remote assets.
      name: 'offline-excalidraw-assets',
      enforce: 'pre',
      transform(code, id) {
        if (!id.replaceAll('\\', '/').includes('/@excalidraw/excalidraw/dist/')) return;
        const key = '"ASSETS_FALLBACK_URL",';
        const start = code.indexOf(key);
        if (start < 0) return;
        const from = start + key.length;
        const tail = '/dist/prod/`';
        const to = code.indexOf(tail, from);
        if (!code.slice(from).startsWith('`https://esm.sh/') || to < 0)
          throw new Error('Excalidraw font fallback changed; review the offline adapter');
        return {
          code: code.slice(0, from) + 'window.EXCALIDRAW_ASSET_PATH' + code.slice(to + tail.length),
          map: null,
        };
      },
    },
    {
      name: 'local-board-fonts',
      async closeBundle() {
        await fs.cp(
          'node_modules/@excalidraw/excalidraw/dist/prod/fonts',
          'dist/ui/excalidraw-assets/fonts',
          { recursive: true },
        );
        await fs.copyFile('THIRD-PARTY-NOTICES.md', 'dist/ui/THIRD-PARTY-NOTICES.md');
      },
      configureServer(server) {
        server.middlewares.use('/excalidraw-assets/', async (req, res, next) => {
          const root = path.resolve('node_modules/@excalidraw/excalidraw/dist/prod');
          const file = path.resolve(root, '.' + decodeURIComponent(req.url || ''));
          if (!file.startsWith(root + path.sep) || !file.endsWith('.woff2')) return next();
          try {
            res.setHeader('Content-Type', 'font/woff2');
            res.end(await fs.readFile(file));
          } catch {
            next();
          }
        });
      },
    },
  ],
  base: './',
  build: { outDir: 'dist/ui' },
  server: { host: '127.0.0.1' },
});
