import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { retryD1 } from '../src/db';

// retryD1 wraps every D1 write. It must retry transient D1 errors with a
// bounded number of attempts and surface everything else immediately.
describe('retryD1', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function flaky(errors: string[], value = 'ok') {
    let calls = 0;
    const operation = async () => {
      const error = errors[calls++];
      if (error) throw new Error(error);
      return value;
    };
    return { operation, calls: () => calls };
  }

  it('retries transient errors until the operation succeeds', async () => {
    const op = flaky(['D1_ERROR: SQLITE_BUSY', 'database is locked']);
    const result = expect(retryD1(op.operation)).resolves.toBe('ok');
    await vi.runAllTimersAsync();
    await result;
    expect(op.calls()).toBe(3);
  });

  it('rethrows a non-transient error without retrying', async () => {
    const op = flaky(['D1_ERROR: no such table: nope']);
    await expect(retryD1(op.operation)).rejects.toThrow('no such table');
    expect(op.calls()).toBe(1);
  });

  it('gives up after the attempt budget and rethrows the last transient error', async () => {
    const op = flaky(['SQLITE_BUSY 1', 'SQLITE_BUSY 2', 'SQLITE_BUSY 3', 'SQLITE_BUSY 4']);
    const result = expect(retryD1(op.operation, 3)).rejects.toThrow('SQLITE_BUSY 3');
    await vi.runAllTimersAsync();
    await result;
    expect(op.calls()).toBe(3);
  });
});
