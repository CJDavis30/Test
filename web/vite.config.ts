import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname),
  plugins: [react()],
  resolve: { alias: { '@shared': resolve(__dirname, '../shared') } },
  server: {
    port: 5173,
    host: '127.0.0.1',
    fs: { allow: [resolve(__dirname, '..')] },
    proxy: { '/api': { target: 'http://127.0.0.1:4317', changeOrigin: false, configure: (p) => p.on('proxyReq', (r) => r.setHeader('host', 'localhost:4317')) } },
  },
  build: { outDir: resolve(__dirname, '../dist/web'), emptyOutDir: true, chunkSizeWarningLimit: 900 },
});
