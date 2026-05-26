import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { inertiaPages } from '@hono/inertia/vite';
import ssrPlugin from 'vite-ssr-components/plugin';

// Vitest merges this config; the Cloudflare worker plugin would take over the
// test runtime, so only enable the build plugins outside of test runs. Tests
// rely on Vite's own import.meta.glob transform, which is always available.
const isTest = !!process.env.VITEST;

export default defineConfig({
  plugins: isTest
    ? []
    : [
        inertiaPages({ exclude: ['Layout', '_shared'], serverModule: '../src/app' }),
        cloudflare(),
        ssrPlugin(),
      ],
});
