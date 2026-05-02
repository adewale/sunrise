#!/usr/bin/env node
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const landingUrl = process.env.SUNRISE_LANDING_URL || 'https://sunrise.adewale-883.workers.dev';
const appUrl = process.env.SUNRISE_APP_URL || 'https://sunrise-deploy.adewale-883.workers.dev';
const session = process.env.SUNRISE_SESSION;
const outDir = resolve(process.env.SUNRISE_SCREENSHOT_DIR || 'docs/assets/screenshots');
const mobile = devices['iPhone 13'];

const shots = [
  { name: 'landing.png', url: landingUrl, width: 1440, height: 1050 },
  { name: 'landing-mobile.png', url: landingUrl, mobile: true },
  { name: 'setup.png', url: `${appUrl}/setup`, width: 1440, height: 1050 },
  { name: 'design.png', url: `${appUrl}/design`, width: 1440, height: 1050 },
  { name: 'dashboard.png', url: `${appUrl}/dashboard`, width: 1440, height: 1050, auth: true },
  { name: 'dashboard-mobile.png', url: `${appUrl}/dashboard`, mobile: true, auth: true },
];

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();

for (const shot of shots) {
  if (shot.auth && !session) {
    console.log(`Skipping ${shot.name}: set SUNRISE_SESSION to capture authenticated pages.`);
    continue;
  }
  const context = shot.mobile ? await browser.newContext({ ...mobile }) : await browser.newContext({ viewport: { width: shot.width, height: shot.height }, deviceScaleFactor: 1 });
  if (shot.auth && session) {
    const { hostname } = new URL(appUrl);
    await context.addCookies([{ name: 'sunrise_session', value: session, domain: hostname, path: '/', httpOnly: true, secure: appUrl.startsWith('https://'), sameSite: 'Lax' }]);
  }
  const page = await context.newPage();
  await page.goto(shot.url, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.locator('body').waitFor({ state: 'visible' });
  await page.screenshot({ path: resolve(outDir, shot.name), fullPage: true });
  console.log(`Captured ${shot.name} from ${shot.url}`);
  await context.close();
}

await browser.close();
