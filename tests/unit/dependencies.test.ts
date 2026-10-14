import { describe, expect, it } from 'vitest';
import { DependencyManager } from '../../src/core/DependencyManager.js';

describe('optional subprocess probes', () => {
  it('executes a version probe with an argument array', async () => {
    expect((await new DependencyManager().probe(process.execPath, ['--version'])).status).toBe(
      'ready',
    );
  });
  it('distinguishes missing executables from a failed process without printing stderr', async () => {
    const manager = new DependencyManager();
    expect((await manager.probe('webpulse-no-such-executable-52d932')).message).toContain(
      'missing',
    );
    const result = await manager.probe(process.execPath, [
      '-e',
      'process.stderr.write("secret"); process.exit(1)',
    ]);
    expect(result.status).toBe('unavailable');
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});
