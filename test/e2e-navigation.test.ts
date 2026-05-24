import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { chromium, type Browser } from 'playwright';
import app from '../src/app';
import type { Env } from '../src/env';
import { createMemoryDb } from './memory-db';

// Runtime-fidelity E2E: drive the REAL production client bundle through an
// actual Inertia navigation in a browser. The string/SSR tests never execute
// the client, so they cannot see hydration, SPA navigation (no full reload),
// or the theme toggle surviving a header swap.
//
// `vite preview` runs the built worker in workerd but its local D1 is empty, so
// authenticated/data pages need fragile miniflare seeding. Instead we serve the
// real built bundle (app/client.tsx) over @hono/node-server backed by the same
// in-memory D1 the rest of the suite uses. The only shim: rewrite the worker's
// dev-mode asset tags to the built, hashed assets (vitest runs the worker in
// dev mode), so the browser hydrates the production client.
describe('client-side navigation (live server, built bundle)', () => {
  let server: { close: (cb?: () => void) => void };
  let browser: Browser;
  let port: number;

  beforeAll(async () => {
    // Build the client/worker without VITEST set, so vite.config enables the
    // Cloudflare + SSR plugins (and emits dist/client + its manifest).
    const buildEnv = { ...process.env };
    delete buildEnv.VITEST;
    execSync('npx vite build', { stdio: 'ignore', env: buildEnv });
    const manifest = JSON.parse(readFileSync('dist/client/.vite/manifest.json', 'utf8'));
    const clientSrc = '/' + manifest['app/client.tsx'].file;
    const styleSrc = '/' + manifest['app/styles.css'].file;

    const db = createMemoryDb();
    await db.prepare("INSERT INTO sessions (id, github_login, github_id, access_token, expires_at, created_at) VALUES ('sid','ade','1','tok','2999-01-01T00:00:00Z','2026-01-01T00:00:00Z')").run();
    await db.prepare('INSERT INTO action_items (id, canonical_subject_key, kind, title, repo, url, updated_at, reason, suggested_action, evidence_json, source, ignored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
      .bind('i1', 'k1', 'review_requested', 'Review the launch PR', 'o/r', 'https://github.com/o/r/pull/1', '2026-04-30T00:00:00Z', 'You were requested for review.', 'Review PR', '{}', 'notifications').run();
    const env = { DB: db, OWNER_LOGIN: 'ade' } as unknown as Env;

    const fetchHandler = async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/assets/')) {
        const body = readFileSync(join('dist/client', url.pathname), 'utf8');
        const type = url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript';
        return new Response(body, { headers: { 'content-type': `${type}; charset=utf-8` } });
      }
      const res = await app.fetch(request, env);
      if (!(res.headers.get('content-type') ?? '').includes('text/html')) return res;
      const html = (await res.text())
        .replace(/<script[^>]*src="\/@vite\/client"[^>]*><\/script>/, '')
        .replace('/app/client.tsx', clientSrc)
        .replace('/app/styles.css', styleSrc);
      return new Response(html, { status: res.status, headers: { 'content-type': 'text/html; charset=utf-8' } });
    };

    port = await new Promise<number>((resolve) => {
      server = serve({ fetch: fetchHandler, port: 0 }, (info: { port: number }) => resolve(info.port));
    });
    browser = await chromium.launch();
  }, 120000);

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  });

  it('navigates dashboard -> settings via <Link> without a full reload, and the toggle survives', async () => {
    const origin = `http://localhost:${port}`;
    const context = await browser.newContext();
    await context.addCookies([{ name: 'sunrise_session', value: 'sid', url: origin }]);
    const page = await context.newPage();
    // Drop cross-origin assets (fonts, avatars) so the run is deterministic offline.
    await page.route('**/*', (route) => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));

    const requests: { path: string; type: string }[] = [];
    page.on('request', (r) => { if (r.url().startsWith(origin)) requests.push({ path: new URL(r.url()).pathname, type: r.resourceType() }); });

    await page.goto(`${origin}/dashboard`, { waitUntil: 'load' });
    await page.getByText('Review the launch PR').first().waitFor();
    // Wait for the real client bundle to hydrate before interacting.
    await page.waitForFunction(() => (window as unknown as { __sunriseHydrated?: boolean }).__sunriseHydrated === true, undefined, { timeout: 15000 });

    await page.evaluate(() => ((window as Window & { __alive?: string }).__alive = 'yes'));
    const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme);
    const documentLoadsBefore = requests.filter((r) => r.type === 'document').length;

    await page.click('[aria-label="Settings"]');
    await page.waitForFunction(() => document.body.textContent?.includes('Inbox page size'));

    // Client-side nav, not a full reload: the window context survived.
    expect(await page.evaluate(() => (window as Window & { __alive?: string }).__alive)).toBe('yes');
    expect(requests.filter((r) => r.type === 'document').length).toBe(documentLoadsBefore);
    expect(new URL(page.url()).pathname).toBe('/settings');
    // The dashboard header was swapped out for the settings view.
    expect(await page.evaluate(() => document.body.textContent?.includes('Manual refresh'))).toBe(false);

    // The theme toggle still flips on the freshly swapped header.
    await page.click('.theme-toggle');
    await page.waitForFunction((prev) => document.documentElement.dataset.theme !== prev, themeBefore);
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).not.toBe(themeBefore);

    await context.close();
  }, 30000);
});
