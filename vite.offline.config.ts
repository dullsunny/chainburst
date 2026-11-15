import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/postcss';
import { defineConfig } from 'vite';

const projectPath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  publicDir: false,
  define: {
    __CHAINBURST_OFFLINE__: 'true',
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  resolve: {
    alias: [
      // Explicitly keep the room client out of the downloadable edition.
      { find: /^@\/components\/online-play$/, replacement: projectPath('./offline/online-disabled.ts') },
      { find: /^@\/workers\/(.+\.worker)\?worker$/, replacement: projectPath('./workers/') + '$1.ts?worker&inline' },
      { find: '@', replacement: projectPath('./') },
    ],
  },
  css: { postcss: { plugins: [tailwindcss()] } },
  worker: { format: 'iife' },
  build: {
    license: { fileName: 'THIRD-PARTY-LICENSES.md' },
    lib: {
      entry: projectPath('./offline/main.tsx'),
      name: 'Chainburst',
      formats: ['iife'],
      fileName: 'chainburst',
    },
  },
});
