import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(join(tmpdir(), 'webpulse-package-'));
const npmCli = process.env.npm_execpath;
assert(npmCli, 'Run this check with npm run test:package.');
function run(command, args, cwd = directory) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120000,
    env: { ...process.env, WEBPULSE_CONFIG_DIR: join(directory, 'config') },
  });
  if (result.error || result.status !== 0)
    throw new Error(`${command} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}
const packed = JSON.parse(
  run(
    process.execPath,
    [npmCli, 'pack', '--ignore-scripts', '--json', '--pack-destination', directory],
    root,
  ),
)[0];
assert(packed, 'npm pack returned no package');
for (const required of [
  'dist/index.js',
  'dist/index.cjs',
  'dist/index.d.ts',
  'dist/index.d.cts',
  'dist/cli/index.js',
  'dist/mcp/server.js',
  'dist/mcp/server.cjs',
  'skills/webpulse/SKILL.md',
  'LICENSE',
])
  assert(
    packed.files.some((file) => file.path === required),
    `Missing ${required}`,
  );
assert(
  !packed.files.some((file) =>
    /(^|\/)(tests|node_modules|coverage|\.env|\.git)(\/|$)/.test(file.path),
  ),
  'Unexpected private or development files in package',
);
await writeFile(
  join(directory, 'package.json'),
  JSON.stringify({
    name: 'webpulse-package-smoke',
    version: '1.0.0',
    private: true,
    type: 'module',
  }),
);
run(process.execPath, [
  npmCli,
  'install',
  '--ignore-scripts',
  '--no-audit',
  '--no-fund',
  join(directory, packed.filename),
]);
await writeFile(
  join(directory, 'esm.mjs'),
  `import assert from 'node:assert/strict';
import { WebPulse } from 'web-pulse';
import { createMcpServer } from 'web-pulse/mcp';
const pulse = new WebPulse({env:{}, http:{fetch:async()=>new Response('<html><head><title>Installed</title></head><body><article><p>Installed SDK works.</p></article></body></html>',{headers:{'content-type':'text/html'}})}});
assert.equal((await pulse.web.read('https://example.com')).title,'Installed');
assert.equal(typeof createMcpServer,'function');
assert(pulse.capabilities.list().length>=19);
console.log('ESM SDK OK');`,
);
await writeFile(
  join(directory, 'cjs.cjs'),
  `const assert = require('node:assert/strict'); const { WebPulse } = require('web-pulse'); const { createMcpServer } = require('web-pulse/mcp'); assert(new WebPulse({env:{}}).capabilities.list().length>=19); assert.equal(typeof createMcpServer,'function'); console.log('CJS SDK OK');`,
);
assert.match(run(process.execPath, ['esm.mjs']), /ESM SDK OK/);
assert.match(run(process.execPath, ['cjs.cjs']), /CJS SDK OK/);
for (const extension of ['mts', 'cts']) {
  await writeFile(
    join(directory, `consumer.${extension}`),
    `import { WebPulse, type OperationOutput } from 'web-pulse';
import { createMcpServer } from 'web-pulse/mcp';
const pulse = new WebPulse();
const result: Promise<OperationOutput<'github', 'getRepository'>> = pulse.github.getRepository('octocat', 'Hello-World');
const name: Promise<string> = result.then(repository => repository.full_name);
void name; void createMcpServer;
// @ts-expect-error Invalid input must not typecheck.
pulse.execute({channel:'github',operation:'getRepository',params:{owner:123,repo:'repo'}});
`,
  );
}
run(process.execPath, [
  join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
  '--strict',
  '--module',
  'NodeNext',
  '--moduleResolution',
  'NodeNext',
  '--target',
  'ES2023',
  '--noEmit',
  '--skipLibCheck',
  '--types',
  'node',
  '--typeRoots',
  join(root, 'node_modules', '@types'),
  'consumer.mts',
  'consumer.cts',
]);
const cli = join(directory, 'node_modules', 'web-pulse', 'dist', 'cli', 'index.js');
assert.match(run(process.execPath, [cli, '--help']), /doctor/);
assert.match(run(process.execPath, [cli, '--version']), /0\.1\.0/);
const listed = JSON.parse(run(process.execPath, [cli, 'channels', 'list', '--json']));
assert(
  listed.some(
    (capability) => capability.channel === 'youtube' && capability.operation === 'getTranscript',
  ),
);
// Exercise the installed executable shim as a global-style invocation as well.
if (process.platform === 'win32') {
  const result = spawnSync(
    process.env.ComSpec ?? 'cmd.exe',
    ['/d', '/c', 'node_modules\\.bin\\webpulse.cmd --version'],
    { cwd: directory, windowsHide: true, encoding: 'utf8', timeout: 10000 },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0\.1\.0/);
} else
  assert.match(run(join(directory, 'node_modules', '.bin', 'webpulse'), ['--version']), /0\.1\.0/);
const client = new Client({ name: 'installed-package-check', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [cli, 'mcp', 'start'],
  env: {
    ...Object.fromEntries(
      Object.entries(process.env).filter((entry) => typeof entry[1] === 'string'),
    ),
    WEBPULSE_CONFIG_DIR: join(directory, 'config'),
  },
  stderr: 'pipe',
});
try {
  await client.connect(transport);
  assert((await client.listTools()).tools.some((tool) => tool.name === 'webpulse_web_read'));
  const result = await client.callTool({
    name: 'webpulse_web_read',
    arguments: { url: 'http://169.254.169.254/' },
  });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error.code, 'UNSAFE_URL');
} finally {
  await client.close();
}
const installed = JSON.parse(
  await readFile(join(directory, 'node_modules', 'web-pulse', 'package.json'), 'utf8'),
);
assert.equal(installed.name, 'web-pulse');
console.log(
  `Package verified: ESM, CJS, CLI executable, MCP stdio, contents.\nArtifacts retained at ${directory}`,
);
