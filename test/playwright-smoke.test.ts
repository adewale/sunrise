import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

// Browser-rendered smoke checks against `vite preview` (real production worker
// in workerd). Asserts the page actually paints the expected landmarks and the
// fixed/sticky site-header anchors to the viewport at the mobile breakpoint.
describe('Browser smoke checks (vite preview)', () => {
  let browser: Browser;
  const origin = inject('browserOrigin');

  beforeAll(async () => {
    browser = await chromium.launch();
  }, 30000);

  afterAll(async () => {
    await browser?.close();
  });

  async function expectText(page: Page, text: string) {
    expect(await page.getByText(text).first().isVisible()).toBe(true);
  }

  it('renders landing and mobile dashboard landmarks', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route('**/*', (route) => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));

    // Landing: public, no session needed.
    await page.goto(`${origin}/`, { waitUntil: 'load' });
    await expectText(page, 'Sunrise');
    await expectText(page, 'Deploy your own');
    expect(await page.locator('.product-shot img').count()).toBe(1);

    // Dashboard (mobile): seeded session + item, real CSS, sticky header pinned to 0,0.
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addCookies([{ name: 'sunrise_session', value: 'sid', url: origin }]);
    const mobile = await context.newPage();
    await mobile.route('**/*', (route) => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));
    await mobile.goto(`${origin}/dashboard`, { waitUntil: 'load' });
    await expectText(mobile, 'Manual refresh');
    await expectText(mobile, 'Review the launch PR');
    expect(await mobile.locator('.site-header').boundingBox()).toMatchObject({ x: 0, y: 0, width: 390 });

    await context.close();
    await page.close();
  });
});
