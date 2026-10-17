import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  build: { outDir: '../../dist/renderer', emptyOutDir: true, assetsInlineLimit: 0,
    rollupOptions: { input: { main: resolve('src/renderer/index.html'), overlay: resolve('src/renderer/overlay.html') } } },
  server: { host: '127.0.0.1', port: 1420, strictPort: true },
  resolve: { alias: { '@shared': resolve('src/shared') } },
});
