import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

const migrations = await readD1Migrations('./migrations');

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['test/**/*.test.ts'],
          exclude: ['test/**/*.workers.test.ts'],
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
          }),
        ],
        test: {
          name: 'workers',
          include: ['test/**/*.workers.test.ts'],
        },
      },
    ],
  },
});
