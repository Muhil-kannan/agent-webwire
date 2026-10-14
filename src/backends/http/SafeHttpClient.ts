import { Agent } from 'undici';
import {
  AuthenticationError,
  NetworkError,
  RateLimitError,
  WebWireError,
} from '../../core/errors.js';
import { abortable, abortError } from '../../core/BackendManager.js';
import { publicUrl, resolvePublic, type Resolver } from '../../security/url.js';
import { z } from 'zod';

export interface HttpResponse {
  url: string;
  headers: Headers;
  status: number;
  text: string;
}
export interface HttpOptions {
  timeout?: number;
  maxBytes?: number;
  /** Trusted test/embedding hooks. Replacing fetch assumes responsibility for transport security. */
  fetch?: typeof globalThis.fetch;
  resolver?: Resolver;
}
export interface RequestOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  body?: string;
  /** Protocol-specific responses to pass through after the normal size/security checks. */
  acceptedStatuses?: readonly number[];
  redirect?: 'follow' | 'error';
}
export function retryAfter(headers: Headers): number | undefined {
  const value = headers.get('retry-after');
  if (value) {
    const seconds = Number(value);
    const result = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
    if (Number.isFinite(result)) return Math.max(0, result);
  }
  const reset = Number(headers.get('x-ratelimit-reset'));
  return reset > 0 ? Math.max(0, reset * 1000 - Date.now()) : undefined;
}
export async function boundedText(response: Response, maxBytes: number): Promise<string> {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw new WebWireError(
      'RESPONSE_TOO_LARGE',
      'The response exceeded the configured size limit.',
    );
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes)
        throw new WebWireError(
          'RESPONSE_TOO_LARGE',
          'The response exceeded the configured size limit.',
        );
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export class SafeHttpClient {
  private readonly timeout: number;
  private readonly maxBytes: number;
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: HttpOptions = {}) {
    this.timeout = options.timeout ?? 15000;
    this.maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
    this.fetcher = options.fetch ?? globalThis.fetch;
    if (
      !Number.isInteger(this.timeout) ||
      this.timeout < 100 ||
      this.timeout > 120000 ||
      !Number.isInteger(this.maxBytes) ||
      this.maxBytes < 1 ||
      this.maxBytes > 20 * 1024 * 1024
    )
      throw new WebWireError('CONFIGURATION', 'Invalid HTTP timeout or response size limit.');
  }
  async request(input: string, options: RequestOptions = {}): Promise<HttpResponse> {
    const signal = AbortSignal.any([
      AbortSignal.timeout(this.timeout),
      ...(options.signal ? [options.signal] : []),
    ]);
    let url = publicUrl(input);
    const dispatcher = new Agent({
      connect: {
        lookup: (hostname, lookupOptions, callback) => {
          resolvePublic(hostname, this.options.resolver)
            .then((addresses) => {
              const selected = addresses.find(
                (address) => !lookupOptions.family || address.family === lookupOptions.family,
              );
              if (!selected) return callback(new Error('No compatible public address.'), '', 4);
              if (lookupOptions.all) callback(null, addresses);
              else callback(null, selected.address, selected.family);
            })
            .catch(() => callback(new Error('Public address resolution failed.'), '', 4));
        },
      },
    });
    const headers = new Headers({
      'user-agent': 'agent-webwire/0.1.0',
      accept: 'application/json, text/html;q=0.9, */*;q=0.8',
      ...options.headers,
    });
    try {
      return await abortable(async () => {
        for (let redirect = 0; redirect <= 5; redirect++) {
          const init: RequestInit & { dispatcher: Agent } = {
            method: options.method ?? 'GET',
            headers,
            redirect: 'manual',
            signal,
            dispatcher,
            ...(options.body !== undefined ? { body: options.body } : {}),
          };
          const response = await this.fetcher(url, init);
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            await response.body?.cancel();
            if (options.redirect === 'error')
              throw new NetworkError('Redirects are not supported for this request.', {
                recoverable: false,
              });
            const location = response.headers.get('location');
            if (!location || redirect === 5)
              throw new NetworkError('Invalid or excessive HTTP redirects.', {
                recoverable: false,
              });
            const target = publicUrl(new URL(location, url).href);
            if (url.protocol === 'https:' && target.protocol !== 'https:')
              throw new WebWireError('UNSAFE_URL', 'HTTPS redirects must not downgrade to HTTP.');
            if (options.method === 'POST')
              throw new NetworkError('Redirecting API POST requests is unsupported.', {
                recoverable: false,
              });
            if (target.origin !== url.origin) {
              // Never forward credentials or arbitrary caller headers to another origin.
              for (const key of [...headers.keys()])
                if (!['user-agent', 'accept'].includes(key)) headers.delete(key);
            }
            url = target;
            continue;
          }
          const text = await boundedText(response, this.maxBytes);
          if (options.acceptedStatuses?.includes(response.status))
            return { url: url.href, headers: response.headers, status: response.status, text };
          if (
            response.status === 429 ||
            (response.status === 403 &&
              (response.headers.get('x-ratelimit-remaining') === '0' ||
                /quotaExceeded|dailyLimitExceeded|rateLimitExceeded/.test(text)))
          )
            throw new RateLimitError(undefined, { retryAfterMs: retryAfter(response.headers) });
          if ([401, 403].includes(response.status)) throw new AuthenticationError();
          if (response.status === 404)
            throw new WebWireError('NOT_FOUND', 'The requested resource was not found.');
          if (!response.ok)
            throw new NetworkError(`Provider returned HTTP ${response.status}.`, {
              recoverable: response.status >= 500,
            });
          return { url: url.href, headers: response.headers, status: response.status, text };
        }
        throw new NetworkError('Redirect limit exceeded.', { recoverable: false });
      }, signal);
    } catch (error) {
      if (signal.aborted) throw abortError(signal);
      if (error instanceof WebWireError) throw error;
      // Do not echo native fetch errors, URLs, headers, DNS data or response bodies.
      throw new NetworkError();
    } finally {
      await dispatcher.destroy();
    }
  }
  async json<T>(url: string, schema: z.ZodType<T>, options?: RequestOptions): Promise<T> {
    const response = await this.request(url, options);
    let value: unknown;
    try {
      value = JSON.parse(response.text);
    } catch {
      throw new WebWireError('INVALID_RESPONSE', 'The provider did not return valid JSON.');
    }
    const result = schema.safeParse(value);
    if (!result.success)
      throw new WebWireError(
        'INVALID_RESPONSE',
        'The provider returned an unexpected response schema.',
      );
    return result.data;
  }
}
