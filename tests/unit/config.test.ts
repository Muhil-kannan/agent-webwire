import { mkdtemp, readFile, writeFile, lstat, symlink, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigManager, configDirectory, parseConfig } from '../../src/core/ConfigManager.js';

const temporary: string[] = [];
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'webwire-config-test-'));
  temporary.push(path);
  return path;
}
afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});
describe('safe configuration', () => {
  it('loads defaults without creating files, saves atomically with private modes', async () => {
    const dir = await directory();
    const manager = new ConfigManager(join(dir, 'settings'));
    expect(await manager.load()).toEqual(parseConfig({}));
    await expect(lstat(join(dir, 'settings'))).rejects.toMatchObject({ code: 'ENOENT' });
    await manager.save({ timeout: 5000, auth: { github: 'MY_GITHUB_TOKEN' } });
    expect((await manager.load()).timeout).toBe(5000);
    expect(await readFile(manager.path, 'utf8')).toContain('MY_GITHUB_TOKEN');
    if (process.platform !== 'win32') expect((await lstat(manager.path)).mode & 0o777).toBe(0o600);
    await manager.save({ retries: 0 });
    expect((await manager.load()).retries).toBe(0);
  });
  it('fails closed on malformed, oversized or non-file configuration', async () => {
    const dir = await directory();
    const manager = new ConfigManager(dir);
    await writeFile(manager.path, '{bad');
    await expect(manager.load()).rejects.toMatchObject({ code: 'CONFIGURATION' });
    await writeFile(manager.path, 'x'.repeat(65537));
    await expect(manager.load()).rejects.toThrow('64 KiB');
    await rm(manager.path);
    await mkdir(manager.path);
    await expect(manager.load()).rejects.toMatchObject({ code: 'CONFIGURATION' });
  });
  it('rejects secrets and invalid settings without echoing values', () => {
    for (const value of [
      { token: 'secret' },
      { auth: { github: 'ghp-secret' } },
      { timeout: -1 },
      { retries: 9 },
      { timeout: '100' },
    ])
      expect(() => parseConfig(value)).toThrow('Invalid WebWire settings');
  });
  it('resolves platform paths and explicit overrides', () => {
    expect(configDirectory('win32', { APPDATA: 'R:/Roaming' }, 'H:/User')).toContain('webwire');
    expect(configDirectory('win32', {}, 'H:/User')).toContain('AppData');
    expect(configDirectory('darwin', {}, '/Users/test')).toContain('Application Support');
    expect(configDirectory('linux', { XDG_CONFIG_HOME: '/config' }, '/home/u')).toContain('config');
    expect(configDirectory('linux', {}, '/home/u')).toContain('.config');
    expect(configDirectory('linux', { WEBWIRE_CONFIG_DIR: '/custom' }, '/home/u')).toContain(
      'custom',
    );
  });
  it('rejects symlinked configuration directories', async () => {
    const dir = await directory();
    const target = join(dir, 'target');
    await mkdir(target);
    const linked = join(dir, 'linked');
    // Junctions are supported without administrator rights on Windows.
    await symlink(target, linked, process.platform === 'win32' ? 'junction' : 'dir');
    const manager = new ConfigManager(linked);
    await expect(manager.load()).rejects.toThrow('symbolic links');
    await expect(manager.save({})).rejects.toThrow('symbolic links');
  });
});
