import { describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import app from '../src/app';
import type { Env } from '../src/env';
import { createMemoryDb } from './memory-db';

describe('Playwright smoke checks', () => {
  it('renders the project landing and mobile dashboard landmarks', async () => {
    const browser = await chromium.launch();
    try {
      const landingHtml = await (await app.request('/', {}, { DB: createMemoryDb(), PROJECT_LANDING: 'true', GITHUB_REPO_URL: 'https://github.com/adewale/sunrise' } as unknown as Env)).text();
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.setContent(landingHtml);
      await expectText(page, 'Sunrise');
      await expectText(page, 'Deploy your own');
      expect(await page.locator('.product-shot img').count()).toBe(1);
      await page.close();

      const db = createMemoryDb();
      await db.prepare("INSERT INTO sessions (id, github_login, github_id, access_token, expires_at, created_at) VALUES ('sid','ade','1','tok','2999-01-01T00:00:00Z','2026-01-01T00:00:00Z')").run();
      await db.prepare('INSERT INTO action_items (id, canonical_subject_key, kind, title, repo, url, updated_at, reason, suggested_action, evidence_json, source, ignored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
        .bind('i1', 'k1', 'review_requested', 'Review me', 'o/r', 'https://github.com/o/r/pull/1', '2026-05-01T00:00:00Z', 'Review requested', 'Review PR', '{}', 'notifications').run();
      const dashboardHtml = await (await app.request('/dashboard', { headers: { Cookie: 'sunrise_session=sid' } }, { DB: db, OWNER_LOGIN: 'ade' } as unknown as Env)).text();
      const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await mobile.setContent(dashboardHtml);
      await expectText(mobile, 'Manual refresh');
      await expectText(mobile, 'Review me');
      expect(await mobile.locator('.site-header').boundingBox()).toMatchObject({ x: 0, y: 0, width: 390 });
      await mobile.close();
    } finally {
      await browser.close();
    }
  });
});

async function expectText(page: any, text: string) {
  expect(await page.getByText(text).first().isVisible()).toBe(true);
}
