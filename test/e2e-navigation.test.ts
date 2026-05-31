import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { chromium, type Browser } from 'playwright';

// Runtime-fidelity E2E: drive the REAL production server (`vite preview` in
// workerd) through an actual Inertia <Link> navigation in a real browser. The
// string/SSR tests never execute the client, so they cannot see hydration,
// SPA navigation (no full reload), or the theme toggle surviving a header swap.
//
// globalSetup builds, seeds the local D1, and spawns vite preview. The origin
// is injected here.

describe('client-side navigation (vite preview, real browser)', () => {
  let browser: Browser;
  const origin = inject('browserOrigin');

  beforeAll(async () => {
    browser = await chromium.launch();
  }, 30000);

  afterAll(async () => {
    await browser?.close();
  });

  it('navigates dashboard -> settings via <Link> without a full reload, and the toggle survives', async () => {
    const context = await browser.newContext();
    await context.addCookies([{ name: 'sunrise_session', value: 'sid', url: origin }]);
    const page = await context.newPage();
    // Drop cross-origin assets (fonts, avatars) so the run is deterministic offline.
    await page.route('**/*', (route) => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));

    const requests: { path: string; type: string }[] = [];
    page.on('request', (r) => { if (r.url().startsWith(origin)) requests.push({ path: new URL(r.url()).pathname, type: r.resourceType() }); });

    await page.goto(`${origin}/dashboard`, { waitUntil: 'load' });
    await page.getByText('Review the launch PR').first().waitFor();
    // Wait for the production client bundle to hydrate before interacting.
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
  });
});
