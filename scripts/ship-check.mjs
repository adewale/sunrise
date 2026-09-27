#!/usr/bin/env node
// Single-command local ship-readiness check. Runs:
//   1. Playwright Chromium install (idempotent; a no-op when the revision the
//      installed Playwright wants is already present)
//   2. wrangler types (regenerates worker-configuration.d.ts)
//   3. tsc --noEmit
//   4. vite build (production client + worker)
//   5. vitest run (workers pool + Playwright-driven preview)
//
// Stops on the first failure. Exits 0 only if every step passes.
// Run with: npm run ship-check
import { spawnSync } from 'node:child_process';

const steps = [
  { name: 'Playwright Chromium', fn: ensurePlaywrightChromium },
  { name: 'wrangler types',      fn: () => run('npx', ['wrangler', 'types']) },
  { name: 'TypeScript',          fn: () => run('npx', ['tsc', '--noEmit']) },
  { name: 'Production build',    fn: () => run('npx', ['vite', 'build']) },
  { name: 'Test suite',          fn: () => run('npx', ['vitest', 'run']) },
];

const results = [];
let failedAt = -1;
for (let i = 0; i < steps.length; i++) {
  const step = steps[i];
  process.stdout.write(`\n[${i + 1}/${steps.length}] ${step.name}\n`);
  const start = Date.now();
  const code = await step.fn();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  results.push({ name: step.name, code, elapsed });
  if (code !== 0) { failedAt = i; break; }
}

process.stdout.write('\n──────── ship-check summary ────────\n');
for (let i = 0; i < steps.length; i++) {
  const r = results[i];
  if (!r) { process.stdout.write(`  ⃟  ${steps[i].name} (skipped)\n`); continue; }
  const mark = r.code === 0 ? '✓' : '✗';
  process.stdout.write(`  ${mark}  ${r.name}  (${r.elapsed}s)\n`);
}
if (failedAt === -1) {
  process.stdout.write('\nAll checks passed. Safe to deploy.\n');
  process.stdout.write('Still requires hands-on verification on your live Cloudflare account:\n');
  process.stdout.write('  • wrangler deploy succeeds and the worker boots\n');
  process.stdout.write('  • OAuth round-trip (login → callback → dashboard) with your real GitHub OAuth App\n');
  process.stdout.write('  • A cron tick produces a scan_run with trigger=cron\n');
  process.stdout.write('  • A Manual refresh drains the real Queues broker (visible on /runs)\n');
  process.exit(0);
} else {
  process.stdout.write(`\nFailed at step ${failedAt + 1}: ${steps[failedAt].name}. See output above.\n`);
  process.exit(1);
}

async function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: 'inherit', env });
  return result.status ?? 1;
}

async function ensurePlaywrightChromium() {
  // Always ask Playwright itself. It knows which Chromium revision this
  // version needs, honours PLAYWRIGHT_BROWSERS_PATH, and skips the download
  // when that revision is already installed. Guessing from directory names
  // (the old check looked for chromium-1194) skipped the install whenever a
  // stale revision was present, and the browser tests then failed with
  // "Executable doesn't exist".
  return run('npx', ['playwright', 'install', 'chromium']);
}
