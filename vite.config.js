import { defineConfig } from 'vite';

// base relativa: funziona su GitHub Pages (/games/) e ovunque
export default defineConfig({
  base: './',
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
});
