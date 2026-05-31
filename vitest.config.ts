import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

const migrations = await readD1Migrations('./migrations');

// Two test projects:
//   - workers: the default. Tests run inside the real workerd via miniflare,
//     against real D1, real Inertia SSR, real Hono routing. Most of the suite.
//   - browser: Playwright tests that drive `vite preview` (the production
//     worker in workerd) in a real Chromium. Needs Node APIs (chromium.launch,
//     child_process), so the test process is Node; the actual app runs in
//     workerd through the preview server. globalSetup builds + seeds + spawns.
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
          }),
        ],
        test: {
          name: 'workers',
          include: ['test/**/*.test.ts'],
          exclude: ['test/e2e-navigation.test.ts', 'test/playwright-smoke.test.ts'],
          setupFiles: ['test/setup.workers.ts'],
        },
      },
      {
        test: {
          name: 'browser',
          environment: 'node',
          include: ['test/e2e-navigation.test.ts', 'test/playwright-smoke.test.ts'],
          globalSetup: ['test/browser-globalSetup.ts'],
          testTimeout: 30000,
        },
      },
    ],
  },
});
