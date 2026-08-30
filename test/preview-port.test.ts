import { describe, expect, it } from 'vitest';
import { parsePreviewPort } from './preview-port';

describe('preview port parsing', () => {
  it('reads the URL from ANSI-colored Vite output', () => {
    const output = '\u001b[1;32m➜\u001b[0m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://127.0.0.1:4173/\u001b[39m';

    expect(parsePreviewPort(output)).toBe(4173);
  });
});
