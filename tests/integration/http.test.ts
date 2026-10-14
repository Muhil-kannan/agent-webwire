import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { SafeHttpClient, retryAfter } from '../../src/backends/http/SafeHttpClient.js';

const endpoint = 'https://example.com/data';
describe('guarded native HTTP', () => {
  it('rejects literal private targets before calling fetch', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(new SafeHttpClient({ fetch }).request('http://127.0.0.1/')).rejects.toMatchObject({
      code: 'UNSAFE_URL',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('revalidates redirects before fetching a private target', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response('', {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data' },
      }),
    );
    await expect(new SafeHttpClient({ fetch }).request(endpoint)).rejects.toMatchObject({
      code: 'UNSAFE_URL',
    });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('blocks DNS rebinding and mixed answers inside the native socket connector', async () => {
    for (const addresses of [
      [{ address: '127.0.0.1', family: 4 }],
      [
        { address: '8.8.8.8', family: 4 },
        { address: '169.254.169.254', family: 4 },
      ],
    ]) {
      const resolver = vi.fn(async () => addresses);
      await expect(
        new SafeHttpClient({ resolver, timeout: 1000 }).request(endpoint),
      ).rejects.toMatchObject({ code: 'NETWORK' });
      expect(resolver).toHaveBeenCalled();
    }
  });
  it('strips caller headers on a cross-origin redirect and preserves public content', async () => {
    const observed: Headers[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (_, init) => {
      observed.push(new Headers(init?.headers));
      return observed.length === 1
        ? new Response('', { status: 302, headers: { location: 'https://other.com/page' } })
        : new Response('ok');
    });
    const result = await new SafeHttpClient({ fetch }).request(endpoint, {
      headers: { authorization: 'Bearer secret', cookie: 'session=secret', 'x-api-key': 'secret' },
    });
    expect(result.url).toBe('https://other.com/page');
    expect(observed[0]?.get('authorization')).toBe('Bearer secret');
    expect(observed[1]?.has('authorization')).toBe(false);
    expect(observed[1]?.has('cookie')).toBe(false);
    expect(observed[1]?.has('x-api-key')).toBe(false);
  });
  it('blocks downgrade, redirected POST, missing redirect locations and loops', async () => {
    for (const [location, options, code] of [
      ['http://example.com/data', {}, 'UNSAFE_URL'],
      ['https://example.com/other', { method: 'POST' as const, body: '{}' }, 'NETWORK'],
      [undefined, {}, 'NETWORK'],
    ] as const) {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockImplementation(
          async () => new Response('', { status: 302, headers: location ? { location } : {} }),
        );
      await expect(new SafeHttpClient({ fetch }).request(endpoint, options)).rejects.toMatchObject({
        code,
      });
    }
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(
        async () => new Response('', { status: 302, headers: { location: '/again' } }),
      );
    await expect(new SafeHttpClient({ fetch }).request(endpoint)).rejects.toThrow('redirects');
    expect(fetch).toHaveBeenCalledTimes(6);
  });
  it.each([
    [401, 'AUTHENTICATION'],
    [403, 'AUTHENTICATION'],
    [404, 'NOT_FOUND'],
    [429, 'RATE_LIMIT'],
    [500, 'NETWORK'],
    [400, 'NETWORK'],
  ])('maps HTTP %s without reflecting secret bodies', async (status, code) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('secret-api-response', { status: Number(status) }));
    const result = new SafeHttpClient({ fetch }).request(endpoint).catch((error: unknown) => error);
    expect(await result).toMatchObject({ code });
    expect(String(await result)).not.toContain('secret-api-response');
  });
  it('reports provider reset hints and Google quota failures', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response('quotaExceeded', { status: 403, headers: { 'retry-after': '30' } }),
      );
    await expect(new SafeHttpClient({ fetch }).request(endpoint)).rejects.toMatchObject({
      code: 'RATE_LIMIT',
      details: { retryAfterMs: 30000 },
    });
    expect(retryAfter(new Headers({ 'retry-after': 'invalid' }))).toBeUndefined();
    expect(
      retryAfter(new Headers({ 'retry-after': new Date(Date.now() + 60000).toUTCString() })),
    ).toBeGreaterThan(58000);
    expect(
      retryAfter(new Headers({ 'x-ratelimit-reset': String(Math.ceil(Date.now() / 1000) + 60) })),
    ).toBeGreaterThan(59000);
  });
  it('bounds declared and streamed response bytes', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(
        async () => new Response('0123456789', { headers: { 'content-length': '10' } }),
      );
    await expect(
      new SafeHttpClient({ fetch, maxBytes: 5 }).request(endpoint),
    ).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
    fetch.mockImplementation(async () => new Response('0123456789'));
    await expect(
      new SafeHttpClient({ fetch, maxBytes: 5 }).request(endpoint),
    ).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
  });
  it('enforces timeouts and pre-aborted cancellation even for an uncooperative transport', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => new Promise(() => {}));
    await expect(
      new SafeHttpClient({ fetch, timeout: 100 }).request(endpoint),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
    const controller = new AbortController();
    controller.abort();
    await expect(
      new SafeHttpClient({ fetch }).request(endpoint, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
  });
  it('rejects malformed JSON, invalid output schemas and unsafe transport settings', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => new Response('{bad'));
    await expect(
      new SafeHttpClient({ fetch }).json(endpoint, z.object({ id: z.string() })),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    fetch.mockImplementation(async () => Response.json({ id: 1 }));
    await expect(
      new SafeHttpClient({ fetch }).json(endpoint, z.object({ id: z.string() })),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(() => new SafeHttpClient({ maxBytes: -1 })).toThrow();
  });
});
