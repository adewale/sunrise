import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

// Smoke test that the worker boots inside the real workerd runtime with the
// wrangler.jsonc bindings (D1, Queues, cron triggers) and serves a public
// route end-to-end. This complements the node-environment tests, which use an
// in-memory D1 stand-in: anything that depends on real workerd or real CF
// binding behaviour can be exercised here in a future test.
describe('worker (workerd runtime)', () => {
  it('boots and serves the favicon through the real worker', async () => {
    const res = await SELF.fetch('http://example.com/favicon.svg');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/svg+xml');
    const svg = await res.text();
    expect(svg).toContain('<title>Sunrise favicon</title>');
  });
});
