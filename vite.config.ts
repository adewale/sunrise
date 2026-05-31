import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { inertiaPages } from '@hono/inertia/vite';
import ssrPlugin from 'vite-ssr-components/plugin';

export default defineConfig({
  plugins: [
    inertiaPages({ exclude: ['Layout', '_shared'], serverModule: '../src/app' }),
    cloudflare(),
    ssrPlugin(),
  ],
});
