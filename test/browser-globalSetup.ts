import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';

// Builds the worker + client, seeds the local miniflare D1, spawns `vite
// preview` (the production worker in workerd against that same D1), and
// exposes the origin to the browser tests. Eliminates the dev->prod asset-URL
// rewrite shim: tests hit a real production server with real hashed assets and
// real Inertia hydration.

declare module 'vitest' {
  export interface ProvidedContext {
    browserOrigin: string;
  }
}

const SEED_SQL_PATH = '/tmp/sunrise-browser-seed.sql';

async function readPortFromPreview(child: ChildProcess, timeoutMs = 30000): Promise<number> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`preview did not announce port within ${timeoutMs}ms. output: ${output}`)), timeoutMs);
    const handler = (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/Local:\s+https?:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(parseInt(match[1], 10));
      }
    };
    child.stdout?.on('data', handler);
    child.stderr?.on('data', handler);
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`preview exited before announcing a port. output: ${output}`)); });
  });
}

async function waitForServer(url: string, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.status === 200) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server not ready at ${url}`);
}

export default async function setup({ provide }: { provide: (key: 'browserOrigin', value: string) => void }) {
  // Build with vite.config plugins enabled (vitest sets VITEST=true and
  // NODE_ENV=test; neither must reach vite preview, or the cloudflare/ssr
  // plugins would be disabled and vite would serve dev-mode asset paths
  // instead of the built hashed assets).
  const childEnv: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production' };
  delete childEnv.VITEST;

  execSync('npx vite build', { stdio: 'ignore', env: childEnv });

  // Reset the local D1 file so every run starts on the same seed.
  if (existsSync('.wrangler/state/v3/d1')) {
    rmSync('.wrangler/state/v3/d1', { recursive: true, force: true });
  }
  execSync('npx wrangler d1 migrations apply DB --local', { stdio: 'ignore', env: childEnv });

  writeFileSync(
    SEED_SQL_PATH,
    `INSERT INTO sessions (id, github_login, github_id, access_token, expires_at, created_at) VALUES ('sid','ade','1','tok','2999-01-01T00:00:00Z','2026-01-01T00:00:00Z');
INSERT INTO action_items (id, canonical_subject_key, kind, title, repo, url, updated_at, reason, suggested_action, evidence_json, source, ignored_at) VALUES ('i1', 'k1', 'review_requested', 'Review the launch PR', 'o/r', 'https://github.com/o/r/pull/1', '2026-04-30T00:00:00Z', 'You were requested for review.', 'Review PR', '{}', 'notifications', NULL);
`,
  );
  execSync(`npx wrangler d1 execute DB --local --file ${SEED_SQL_PATH}`, { stdio: 'ignore', env: childEnv });
  unlinkSync(SEED_SQL_PATH);

  // Let vite preview pick any free port (it auto-increments from 4173 when
  // taken); we parse the chosen port from its stdout so we don't rely on
  // anything we couldn't have known until after spawn.
  // detached:true makes the spawned process a new process group leader so we
  // can SIGKILL the entire group (including workerd children) in teardown.
  let previewProcess: ChildProcess | null = spawn(
    'npx',
    ['vite', 'preview', '--host', '127.0.0.1'],
    { stdio: ['ignore', 'pipe', 'pipe'], env: childEnv, detached: true },
  );

  let origin: string;
  try {
    const port = await readPortFromPreview(previewProcess);
    origin = `http://127.0.0.1:${port}`;
    await waitForServer(`${origin}/favicon.svg`);
    // Sanity-check that the prod build is serving by confirming the landing
    // references the hashed client asset (not the dev /app/client.tsx).
    const sample = await fetch(`${origin}/design`).then((r) => r.text());
    if (!/\/assets\/client-[\w-]+\.js/.test(sample)) {
      throw new Error(`vite preview did not serve a prod build (no hashed client asset). HTML: ${sample.slice(0, 600)}`);
    }
  } catch (error) {
    try { if (previewProcess.pid) process.kill(-previewProcess.pid, 'SIGKILL'); } catch {}
    throw error;
  }
  provide('browserOrigin', origin);

  return async () => {
    if (previewProcess && previewProcess.pid && !previewProcess.killed) {
      try { process.kill(-previewProcess.pid, 'SIGKILL'); } catch {}
      previewProcess = null;
    }
  };
}
