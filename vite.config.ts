import { defineConfig } from 'vite';
import { inertiaPages } from '@hono/inertia/vite';

export default defineConfig({
  plugins: [inertiaPages({ pagesDir: 'app/pages', outFile: 'app/pages.gen.ts', serverModule: '../src/app' })],
  build: {
    manifest: true,
    outDir: 'dist/client',
    rollupOptions: {
      input: 'src/client.tsx',
      output: { entryFileNames: 'sunrise-inertia-client.js' },
    },
  },
});
