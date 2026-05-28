import { applyD1Migrations, env, reset } from 'cloudflare:test';
import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import { beforeEach } from 'vitest';

// Workers-pool setup file. Before every test:
//   1. reset() clears all binding storage (D1, KV, etc.) for isolation.
//   2. Reapply D1 migrations against the freshly-reset DB.
//   3. Restore default env vars that previous tests may have mutated.
//
// Tests that need different env values just mutate env in-test (the binding
// object is shared with SELF.fetch's worker context, per vitest-pool-workers).

const DEFAULT_ENV = {
  OWNER_LOGIN: 'ade',
  SESSION_SECRET: 'x',
  GITHUB_CLIENT_ID: '',
  GITHUB_CLIENT_SECRET: '',
  GITHUB_OAUTH_SCOPES: undefined as string | undefined,
  TEST_GITHUB_FIXTURES: undefined as string | undefined,
  PROJECT_LANDING: undefined as string | undefined,
} as const;

beforeEach(async () => {
  await reset();
  const migrations = (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS;
  await applyD1Migrations(env.DB, migrations);
  Object.assign(env, DEFAULT_ENV);
});
