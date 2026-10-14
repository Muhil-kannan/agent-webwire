import { setTimeout as delay } from 'node:timers/promises';
import {
  BackendUnavailableError,
  ConfigurationError,
  WebPulseError,
  normalizeError,
  ValidationError,
} from './errors.js';
import type { Config } from './ConfigManager.js';
import type { Backend, DiagnosticEvent, Operation, WebPulseChannel } from './types.js';

export function abortError(signal: AbortSignal): WebPulseError {
  return signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError'
    ? new WebPulseError('TIMEOUT', 'The operation deadline expired.', { recoverable: true })
    : new WebPulseError('CANCELLED', 'The operation was cancelled.');
}
/** Enforces cancellation even for plugins that fail to observe their signal. */
export async function abortable<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortError(signal);
  let listener: (() => void) | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        listener = () => reject(abortError(signal));
        signal.addEventListener('abort', listener, { once: true });
        if (signal.aborted) listener();
      }),
    ]);
  } finally {
    if (listener) signal.removeEventListener('abort', listener);
  }
}
const transient = (error: WebPulseError) =>
  ['NETWORK', 'TIMEOUT', 'BACKEND_UNAVAILABLE'].includes(error.code) &&
  error.details.recoverable === true;

export class BackendManager {
  constructor(
    private readonly config: Config,
    private readonly emit: (event: DiagnosticEvent) => void = () => {},
  ) {}
  ordered(channel: WebPulseChannel, operation: string): Backend[] {
    const preferred = this.config.preferredBackends[channel.id];
    if (preferred && !channel.backends.some((backend) => backend.id === preferred))
      throw new ConfigurationError(`Unknown preferred backend for ${channel.id}.`);
    return channel.backends
      .filter((backend) => backend.operations.includes(operation))
      .toSorted((a, b) =>
        a.id === preferred ? -1 : b.id === preferred ? 1 : b.priority - a.priority,
      );
  }
  async execute(
    channel: WebPulseChannel,
    operation: string,
    params: unknown,
    spec: Operation,
    signal: AbortSignal,
  ): Promise<unknown> {
    const input = spec.input.safeParse(params);
    if (!input.success)
      throw new ValidationError(`Invalid parameters for ${channel.id}.${operation}.`, {
        channel: channel.id,
      });
    let last: WebPulseError | undefined;
    for (const backend of this.ordered(channel, operation)) {
      let available: boolean;
      const started = performance.now();
      try {
        available = await abortable(() => backend.isAvailable({ signal }), signal);
      } catch (error) {
        last = signal.aborted ? abortError(signal) : normalizeError(error);
        last.details.channel = channel.id;
        last.details.backend = backend.id;
        this.emit({
          channel: channel.id,
          operation,
          backend: backend.id,
          attempt: 0,
          outcome: 'error',
          code: last.code,
          durationMs: performance.now() - started,
        });
        if (spec.readOnly && this.config.fallback && transient(last) && !signal.aborted) continue;
        throw last;
      }
      if (!available) {
        this.emit({
          channel: channel.id,
          operation,
          backend: backend.id,
          attempt: 0,
          outcome: 'unavailable',
          durationMs: 0,
        });
        continue;
      }
      const attempts = spec.readOnly ? this.config.retries + 1 : 1;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        const start = performance.now();
        try {
          const raw = await abortable(
            () => backend.execute(operation, input.data, { signal }),
            signal,
          );
          const result = spec.output.safeParse(raw);
          if (!result.success)
            throw new WebPulseError(
              'INVALID_RESPONSE',
              'The provider returned an unexpected response schema.',
            );
          this.emit({
            channel: channel.id,
            operation,
            backend: backend.id,
            attempt,
            outcome: 'success',
            durationMs: performance.now() - start,
          });
          return result.data;
        } catch (error) {
          last = signal.aborted ? abortError(signal) : normalizeError(error);
          last.details.channel = channel.id;
          last.details.backend = backend.id;
          this.emit({
            channel: channel.id,
            operation,
            backend: backend.id,
            attempt,
            outcome: 'error',
            code: last.code,
            durationMs: performance.now() - start,
          });
          if (!spec.readOnly || !transient(last) || signal.aborted) throw last;
          if (attempt < attempts)
            await abortable(
              () => delay(Math.min(100 * 2 ** (attempt - 1), 2000), undefined, { signal }),
              signal,
            );
        }
      }
      if (!this.config.fallback || !spec.readOnly) break;
    }
    throw (
      last ??
      new BackendUnavailableError(`No configured backend supports ${channel.id}.${operation}.`, {
        channel: channel.id,
        suggestedAction: 'Run webpulse doctor and configure the required environment variables.',
      })
    );
  }
}
