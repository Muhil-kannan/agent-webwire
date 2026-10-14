import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCli } from '../../src/cli/program.js';
import { WebWire } from '../../src/index.js';
import { repository, html } from '../fixtures/data.js';

const directories: string[] = [];
const oldExitCode = process.exitCode;
afterEach(async () => {
  process.exitCode = oldExitCode;
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function cli(args: string[], pulse?: WebWire) {
  const out: string[] = [];
  const err: string[] = [];
  process.exitCode = 0;
  await runCli(
    ['node', 'webwire', ...args],
    { out: (s) => out.push(s), err: (s) => err.push(s) },
    pulse,
  );
  return { out: out.join('\n'), err: err.join('\n'), code: Number(process.exitCode) };
}
describe('CLI behavior', () => {
  it('prints real help/version and machine-readable discovery', async () => {
    expect((await cli(['--help'])).out).toContain('doctor');
    expect((await cli(['--version'])).out).toContain('0.1.0');
    const result = await cli(['channels', 'list', '--json'], new WebWire({ env: {} }));
    expect(JSON.parse(result.out)).toContainEqual(
      expect.objectContaining({ channel: 'web', operation: 'read' }),
    );
    expect(result.code).toBe(0);
    expect(result.err).toBe('');
  });
  it('routes command arguments into actual SDK calls and keeps JSON stdout clean', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (input) =>
        String(input).includes('api.github.com')
          ? Response.json({ items: [repository], total_count: 1 })
          : new Response(html, { headers: { 'content-type': 'text/html' } }),
      );
    const pulse = new WebWire({ env: {}, http: { fetch } });
    const search = await cli(
      ['github', 'search', 'typescript', '--page', '2', '--limit', '3', '--json'],
      pulse,
    );
    expect(JSON.parse(search.out)).toMatchObject({ page: 2, total: 1 });
    expect(String(fetch.mock.calls[0]?.[0])).toContain('page=2');
    const page = await cli(['web', 'read', 'https://example.com', '--json'], pulse);
    expect(JSON.parse(page.out).title).toBe('Example article');
    expect(page.err).toBe('');
    const invalid = await cli(['web', 'read', 'http://localhost', '--json'], pulse);
    expect(invalid.out).toBe('');
    expect(JSON.parse(invalid.err).error.code).toBe('UNSAFE_URL');
    expect(invalid.code).toBe(1);
  });
  it('reports unavailable credentials, invalid arguments and malformed generic JSON', async () => {
    const pulse = new WebWire({ env: {} });
    const missing = await cli(['youtube', 'search', 'AI', '--json'], pulse);
    expect(JSON.parse(missing.err).error.code).toBe('BACKEND_UNAVAILABLE');
    expect(missing.code).toBe(1);
    const bad = await cli(['github', 'search', 'q', '--limit', 'secret-value', '--json'], pulse);
    expect(bad.err).not.toContain('secret-value');
    expect(JSON.parse(bad.err).error.code).toBe('VALIDATION');
    expect(bad.code).toBe(2);
    const malformed = await cli(['execute', 'web', 'read', '{bad', '--json'], pulse);
    expect(JSON.parse(malformed.err).error.code).toBe('CONFIGURATION');
  });
  it('performs a safe environment check and does not create config files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'webwire-cli-test-'));
    directories.push(dir);
    const result = await cli(['--config-dir', dir, 'install', '--dry-run', '--json']);
    expect(JSON.parse(result.out)).toMatchObject({
      mode: 'dry-run',
      systemChanges: [],
      externalToolsRequired: [],
      node: { status: 'ready' },
    });
    await expect(readFile(join(dir, 'config.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('configures references safely and rejects invalid changes before writes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'webwire-cli-config-'));
    directories.push(dir);
    const args = ['--config-dir', dir];
    expect(
      (
        await cli([
          ...args,
          'configure',
          '--auth',
          'github=CUSTOM_GH_TOKEN',
          '--timeout',
          '5000',
          '--json',
        ])
      ).code,
    ).toBe(0);
    const saved = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'));
    expect(saved.auth).toEqual({ github: 'CUSTOM_GH_TOKEN' });
    expect(saved.timeout).toBe(5000);
    const before = JSON.stringify(saved);
    const invalid = await cli([...args, 'configure', '--auth', 'github=ghp-secret']);
    expect(invalid.code).toBe(1);
    expect(invalid.err).not.toContain('ghp-secret');
    expect(JSON.stringify(JSON.parse(await readFile(join(dir, 'config.json'), 'utf8')))).toBe(
      before,
    );
    expect((await cli([...args, 'configure', '--enable', 'missing'])).code).toBe(1);
    expect(
      JSON.parse((await cli([...args, 'configure', '--show', '--json'])).out).config.timeout,
    ).toBe(5000);
  });
  it('uses truthful doctor statuses and nonzero exit codes for unavailable channels', async () => {
    const missing = await cli(
      ['doctor', '--channel', 'youtube', '--json'],
      new WebWire({ env: {} }),
    );
    expect(JSON.parse(missing.out)[0].backends[0].status).toBe('configuration_required');
    expect(missing.code).toBe(1);
    const disabled = await cli(
      ['doctor', '--channel', 'web'],
      new WebWire({ enabledChannels: [] }),
    );
    expect(disabled.out).toContain('DISABLED');
    expect(disabled.code).toBe(0);
  });
});
