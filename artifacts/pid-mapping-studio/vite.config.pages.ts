import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const basePath = process.env.BASE_PATH ?? '/pid-mapping-studio-app/';
const pagesDir = path.resolve(import.meta.dirname, 'dist/pages');
if (!basePath.startsWith('/') || !basePath.endsWith('/')) {
  throw new Error('BASE_PATH must start and end with a slash for GitHub Pages.');
}

export default defineConfig({
  base: basePath,
  define: {
    'import.meta.env.VITE_SINGLE_COMPUTER_MODE': JSON.stringify('true'),
  },
  plugins: [
    react(),
    tailwindcss({ optimize: false }),
    {
      name: 'pages-spa-fallback',
      apply: 'build',
      async closeBundle() {
        await copyFile(
          path.join(pagesDir, 'index.html'),
          path.join(pagesDir, '404.html'),
        );
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(import.meta.dirname, '..', '..', 'attached_assets'),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: pagesDir,
    emptyOutDir: true,
    sourcemap: false,
  },
});
