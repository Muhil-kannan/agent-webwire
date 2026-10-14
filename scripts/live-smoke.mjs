import { WebPulse } from '../dist/index.js';

// Only public credential-free checks; no paid services are contacted implicitly.
const pulse = new WebPulse({ timeout: 20000, retries: 0, env: {} });
// Opt in to consuming Exa's keyless search quota with --search.
const report = await pulse.doctor({
  channels: [
    'web',
    'github',
    'rss',
    'v2ex',
    ...(process.argv.includes('--search') ? ['search'] : []),
  ],
});
for (const result of report) {
  const backend =
    result.backends.find((item) => item.status === 'ready') ??
    result.backends.find((item) => item.status === 'unavailable') ??
    result.backends[0];
  console.log(`${result.channel}: ${backend.status} — ${backend.message} (${backend.scope})`);
}
if (report.some((result) => !result.backends.some((backend) => backend.status === 'ready')))
  process.exitCode = 1;
