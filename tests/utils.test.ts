import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  withRetry,
  withTimeout,
  ReviewError,
  ErrorCodes,
  formatError
} from '../src/utils/error-handler.js';
import { RateLimiter, withRateLimit } from '../src/utils/rate-limiter.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('withRetry', () => {
  it('returns the result without retrying on success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withRetry(fn, 3, 1)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries until the function succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('ok');
    await expect(withRetry(fn, 3, 1)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws RETRY_EXHAUSTED after all retries fail', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    const error = await withRetry(fn, 2, 1).catch(e => e);
    expect(error).toBeInstanceOf(ReviewError);
    expect(error.code).toBe(ErrorCodes.RETRY_EXHAUSTED);
    expect(error.metadata).toMatchObject({ attempts: 3, lastError: 'boom' });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('uses exponential backoff with jitter', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('1'))
      .mockRejectedValueOnce(new Error('2'))
      .mockResolvedValue('ok');

    const promise = withRetry(fn, 3, 1000);
    await vi.advanceTimersByTimeAsync(999);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);       // 1000ms: second attempt
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);       // +2000ms: third attempt
    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    vi.restoreAllMocks();
  });
});

describe('withTimeout', () => {
  it('resolves when the function finishes in time', async () => {
    await expect(withTimeout(async () => 'done', 100)).resolves.toBe('done');
  });

  it('rejects with AGENT_TIMEOUT when the timeout wins', async () => {
    const slow = () => new Promise(resolve => setTimeout(resolve, 200));
    const error = await withTimeout(slow, 10, 'too slow').catch(e => e);
    expect(error).toBeInstanceOf(ReviewError);
    expect(error.code).toBe(ErrorCodes.AGENT_TIMEOUT);
    expect(error.message).toBe('too slow');
    expect(error.metadata).toEqual({ timeoutMs: 10 });
  });

  it('propagates errors thrown by the function', async () => {
    await expect(withTimeout(async () => { throw new Error('inner'); }, 100)).rejects.toThrow('inner');
  });
});

describe('formatError', () => {
  it('formats ReviewError, Error, and other values', () => {
    expect(formatError(new ReviewError('x', ErrorCodes.AGENT_FAILED))).toBe('[AGENT_FAILED] x');
    expect(formatError(new Error('plain'))).toBe('plain');
    expect(formatError('str')).toBe('str');
  });
});

describe('RateLimiter', () => {
  it('allows requests within limits and tracks status', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 2, maxRequestsPerMinute: 10, maxTokensPerMinute: 5000 });
    expect(limiter.canProceed(1000)).toBe(true);

    await limiter.acquire(1000);
    expect(limiter.getStatus()).toMatchObject({
      activeRequests: 1,
      requestsInWindow: 1,
      tokensInWindow: 1000,
      availableRequests: 9,
      availableTokens: 4000
    });

    limiter.release(1500);
    expect(limiter.getStatus()).toMatchObject({ activeRequests: 0, tokensInWindow: 1500 });
  });

  it('blocks when the token budget would be exceeded', async () => {
    const limiter = new RateLimiter({ maxTokensPerMinute: 1000 });
    await limiter.acquire(800);
    limiter.release();
    expect(limiter.canProceed(300)).toBe(false);
    expect(limiter.canProceed(200)).toBe(true);
  });

  it('blocks when requests per minute are exhausted', async () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 2 });
    await limiter.acquire(1);
    limiter.release();
    await limiter.acquire(1);
    limiter.release();
    expect(limiter.canProceed(1)).toBe(false);
  });

  it('frees the window after 60 seconds (sliding window)', async () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter({ maxRequestsPerMinute: 1 });
    await limiter.acquire(1);
    limiter.release();
    expect(limiter.canProceed(1)).toBe(false);
    vi.advanceTimersByTime(60001);
    expect(limiter.canProceed(1)).toBe(true);
  });

  it('waits for a concurrent slot until release() is called', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 1 });
    await limiter.acquire(1);

    let acquired = false;
    const second = limiter.acquire(1).then(() => { acquired = true; });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(acquired).toBe(false);

    limiter.release();
    await second;
    expect(acquired).toBe(true);
    expect(limiter.getStatus().activeRequests).toBe(1);
  });

  it('withRateLimit releases the slot on success and failure', async () => {
    const limiter = new RateLimiter();
    await expect(withRateLimit(limiter, async () => 42)).resolves.toBe(42);
    await expect(withRateLimit(limiter, async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(limiter.getStatus().activeRequests).toBe(0);
  });
});
