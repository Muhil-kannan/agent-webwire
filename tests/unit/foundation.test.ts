import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { BackendManager, abortable } from '../../src/core/BackendManager.js';
import { ChannelRegistry } from '../../src/core/ChannelRegistry.js';
import { CapabilityManager } from '../../src/core/CapabilityManager.js';
import { parseConfig } from '../../src/core/ConfigManager.js';
import {
  AuthenticationError,
  NetworkError,
  RateLimitError,
  WebWireError,
} from '../../src/core/errors.js';
import { health, type Backend, type WebWireChannel } from '../../src/core/types.js';

const spec = {
  input: z.strictObject({ query: z.string().min(1) }),
  output: z.string(),
  readOnly: true,
  description: 'test',
};
function backend(id: string, execute: Backend['execute']): Backend {
  return {
    id,
    priority: id === 'first' ? 100 : 0,
    operations: ['read'],
    isAvailable: vi.fn(async () => true),
    checkHealth: async () => health('ready', 'tested', 'mock'),
    execute: vi.fn(execute),
  };
}
const channel = (...backends: Backend[]): WebWireChannel => ({
  id: 'sample',
  name: 'Sample',
  operations: { read: spec },
  backends,
});
const signal = () => new AbortController().signal;
describe('routing foundation', () => {
  it('normalizes availability failures and falls back only for transient read probes', async () => {
    const first = backend('first', async () => 'unused');
    const second = backend('second', async () => 'ok');
    first.isAvailable = async () => {
      throw new NetworkError();
    };
    const events = vi.fn();
    expect(
      await new BackendManager(parseConfig({}), events).execute(
        channel(first, second),
        'read',
        { query: 'q' },
        spec,
        signal(),
      ),
    ).toBe('ok');
    expect(events).toHaveBeenCalledWith(
      expect.objectContaining({ backend: 'first', attempt: 0, code: 'NETWORK' }),
    );
    first.isAvailable = async () => {
      throw new Error('secret internal exception');
    };
    await expect(
      new BackendManager(parseConfig({})).execute(
        channel(first, second),
        'read',
        { query: 'q' },
        spec,
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'INTERNAL', details: { channel: 'sample', backend: 'first' } });
  });
  it('discovers schemas and prevents duplicate channels and invalid capabilities', () => {
    const registry = new ChannelRegistry();
    const ch = channel(backend('first', async () => 'ok'));
    registry.register(ch);
    expect(new CapabilityManager(registry).list()).toEqual([
      {
        channel: 'sample',
        operation: 'read',
        description: 'test',
        readOnly: true,
        backends: ['first'],
      },
    ]);
    expect(registry.get('sample')).toBe(ch);
    expect(registry.operation('sample', 'read')).toBe(spec);
    expect(() => registry.register(ch)).toThrow('duplicate');
    expect(() => registry.get('missing')).toThrow('not implemented');
    expect(() => registry.operation('sample', 'missing')).toThrow('Unknown operation');
    expect(() => new ChannelRegistry().register({ ...ch, id: 'bad-id' })).toThrow();
    expect(() => new ChannelRegistry().register({ ...ch, backends: [] })).toThrow();
    expect(() =>
      new ChannelRegistry().register({ ...ch, backends: [ch.backends[0]!, ch.backends[0]!] }),
    ).toThrow();
    expect(() =>
      new ChannelRegistry().register({ ...ch, operations: { missing: spec } }),
    ).toThrow();
  });
  it('validates input before availability checks and validates provider output', async () => {
    const b = backend('first', async () => 123);
    const manager = new BackendManager(parseConfig({}));
    await expect(manager.execute(channel(b), 'read', {}, spec, signal())).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    expect(b.isAvailable).not.toHaveBeenCalled();
    await expect(
      manager.execute(channel(b), 'read', { query: 'q' }, spec, signal()),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(b.execute).toHaveBeenCalledTimes(1);
  });
  it('retries transient reads then falls back and emits diagnostics', async () => {
    const events = vi.fn();
    const first = backend('first', async () => {
      throw new NetworkError();
    });
    const second = backend('second', async () => 'fallback');
    const manager = new BackendManager(parseConfig({ retries: 1 }), events);
    expect(
      await manager.execute(channel(first, second), 'read', { query: 'q' }, spec, signal()),
    ).toBe('fallback');
    expect(first.execute).toHaveBeenCalledTimes(2);
    expect(second.execute).toHaveBeenCalledOnce();
    expect(events.mock.calls.map(([event]) => event.outcome)).toEqual([
      'error',
      'error',
      'success',
    ]);
  });
  it('honors explicit preference and validates unknown preferences', async () => {
    const first = backend('first', async () => 'first');
    const second = backend('second', async () => 'second');
    const manager = new BackendManager(parseConfig({ preferredBackends: { sample: 'second' } }));
    expect(
      await manager.execute(channel(first, second), 'read', { query: 'q' }, spec, signal()),
    ).toBe('second');
    expect(() =>
      new BackendManager(parseConfig({ preferredBackends: { sample: 'oops' } })).ordered(
        channel(first),
        'read',
      ),
    ).toThrow('Unknown preferred');
  });
  it.each([
    new AuthenticationError(),
    new RateLimitError(),
    new WebWireError('INVALID_RESPONSE', 'bad'),
    new NetworkError('permanent', { recoverable: false }),
  ])('stops on permanent or credential/quota failures', async (error) => {
    const first = backend('first', async () => {
      throw error;
    });
    const second = backend('second', async () => 'other');
    await expect(
      new BackendManager(parseConfig({})).execute(
        channel(first, second),
        'read',
        { query: 'q' },
        spec,
        signal(),
      ),
    ).rejects.toBe(error);
    expect(first.execute).toHaveBeenCalledOnce();
    expect(second.execute).not.toHaveBeenCalled();
  });
  it('never retries or falls back a write operation', async () => {
    const first = backend('first', async () => {
      throw new NetworkError();
    });
    const second = backend('second', async () => 'other');
    await expect(
      new BackendManager(parseConfig({})).execute(
        channel(first, second),
        'read',
        { query: 'q' },
        { ...spec, readOnly: false },
        signal(),
      ),
    ).rejects.toThrow();
    expect(first.execute).toHaveBeenCalledOnce();
    expect(second.execute).not.toHaveBeenCalled();
  });
  it('supports disabled fallback and unavailable candidates', async () => {
    const first = backend('first', async () => {
      throw new NetworkError();
    });
    const second = backend('second', async () => 'ok');
    await expect(
      new BackendManager(parseConfig({ retries: 0, fallback: false })).execute(
        channel(first, second),
        'read',
        { query: 'q' },
        spec,
        signal(),
      ),
    ).rejects.toThrow();
    expect(second.execute).not.toHaveBeenCalled();
    first.isAvailable = async () => false;
    expect(
      await new BackendManager(parseConfig({})).execute(
        channel(first, second),
        'read',
        { query: 'q' },
        spec,
        signal(),
      ),
    ).toBe('ok');
    second.isAvailable = async () => false;
    await expect(
      new BackendManager(parseConfig({})).execute(
        channel(first, second),
        'read',
        { query: 'q' },
        spec,
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'BACKEND_UNAVAILABLE' });
  });
  it('cancels an uncooperative plugin and cleans up listeners', async () => {
    const controller = new AbortController();
    const pending = abortable(() => new Promise(() => {}), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    await expect(abortable(async () => 'no', controller.signal)).rejects.toMatchObject({
      code: 'CANCELLED',
    });
    await expect(
      abortable(() => new Promise(() => {}), AbortSignal.timeout(100)),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});
