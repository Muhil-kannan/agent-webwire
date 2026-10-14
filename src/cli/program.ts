import { Command, CommanderError, InvalidArgumentError } from 'commander';
import { createInterface } from 'node:readline/promises';
import { WebPulse } from '../core/WebPulse.js';
import { ConfigManager, parseConfig } from '../core/ConfigManager.js';
import { ConfigurationError, publicError } from '../core/errors.js';
import { DependencyManager } from '../core/DependencyManager.js';

export interface CliIO {
  out(value: string): void;
  err(value: string): void;
}
const defaultIO: CliIO = {
  out: (value) => process.stdout.write(value + '\n'),
  err: (value) => process.stderr.write(value + '\n'),
};
const integer = (value: string) => {
  if (!/^\d+$/.test(value)) throw new InvalidArgumentError('Expected a positive integer.');
  return Number(value);
};
const authServices = [
  'github',
  'youtube',
  'youtubeOAuth',
  'reddit',
  'twitter',
  'search',
  'linkedin',
];

export function createProgram(io: CliIO = defaultIO, supplied?: WebPulse) {
  const program = new Command()
    .name('webpulse')
    .description('Connect AI Agents to the Web.')
    .version('0.1.0')
    .option('--json', 'Print machine-readable JSON; errors also use JSON')
    .option('--config-dir <directory>', 'Use a non-default configuration directory')
    .exitOverride()
    .configureOutput({ writeOut: io.out, writeErr: io.err, outputError: () => {} });
  const manager = () => new ConfigManager(program.opts<{ configDir?: string }>().configDir);
  const pulse = async () => supplied ?? WebPulse.fromConfig(manager());
  const output = (value: unknown) =>
    io.out(JSON.stringify(value, null, program.opts().json ? undefined : 2));
  const command = (parent: Command, signature: string, description: string) =>
    parent.command(signature).description(description);

  program
    .command('doctor')
    .description('Run scoped read probes; configured API services may consume quota')
    .option('--channel <channel>', 'Probe a single channel')
    .action(async (options: { channel?: string }) => {
      const results = await (
        await pulse()
      ).doctor({ channels: options.channel ? [options.channel] : undefined });
      if (program.opts().json) output(results);
      else {
        io.out('WebPulse Diagnostics');
        io.out(`Platform: ${process.platform} | Node ${process.version}`);
        for (const result of results) {
          io.out(`\n${result.name} (${result.capabilities.join(', ')})`);
          for (const backend of result.backends) {
            io.out(`  ${backend.status.toUpperCase()} | ${backend.backend}: ${backend.message}`);
            io.out(`  Scope: ${backend.scope}`);
            if (backend.suggestedAction) io.out(`  Fix: ${backend.suggestedAction}`);
          }
        }
      }
      if (
        results.some((result) => {
          const active = result.backends.filter((backend) => backend.status !== 'disabled');
          return active.length > 0 && !active.some((backend) => backend.status === 'ready');
        })
      )
        process.exitCode = 1;
    });
  program
    .command('install')
    .description('Check the runtime safely without installing software or writing configuration')
    .option('--dry-run', 'Show the environment check without changing the machine')
    .action(async (options: { dryRun?: boolean }) => {
      const node = await new DependencyManager().probe(process.execPath, ['--version']);
      output({
        mode: options.dryRun ? 'dry-run' : 'check',
        platform: process.platform,
        arch: process.arch,
        runtime: process.version,
        node,
        systemChanges: [],
        externalToolsRequired: [],
        nextSteps: ['webpulse channels list', 'webpulse configure', 'webpulse doctor'],
      });
      if (node.status !== 'ready') process.exitCode = 1;
    });
  program
    .command('configure')
    .description('Configure non-secret settings and environment-variable references')
    .option('--show', 'Show current non-secret settings without writing')
    .option('--auth <service=ENV_NAME>', 'Store an environment-variable reference, never a token')
    .option('--timeout <milliseconds>', 'Set operation timeout', integer)
    .option('--retries <count>', 'Set transient read retry count', integer)
    .option('--enable <channels>', 'Set comma-separated enabled channel IDs')
    .option('--prefer <channel=backend>', 'Set a preferred backend')
    .action(
      async (options: {
        show?: boolean;
        auth?: string;
        timeout?: number;
        retries?: number;
        enable?: string;
        prefer?: string;
      }) => {
        const store = manager();
        const config = await store.load();
        if (options.show) {
          output({ path: store.path, config });
          return;
        }
        const hasSettings =
          options.auth !== undefined ||
          options.timeout !== undefined ||
          options.retries !== undefined ||
          options.enable !== undefined ||
          options.prefer !== undefined;
        if (!hasSettings) {
          if (!process.stdin.isTTY || !process.stdout.isTTY)
            throw new ConfigurationError(
              'Interactive configure needs a terminal. Use --auth service=ENV_NAME, --timeout, --retries, --enable, --prefer, or --show.',
            );
          const prompt = createInterface({ input: process.stdin, output: process.stderr });
          try {
            const service = (
              await prompt.question(`Service (${authServices.join(', ')}): `)
            ).trim();
            const env = (
              await prompt.question('Environment variable NAME (do not paste a credential): ')
            ).trim();
            options.auth = `${service}=${env}`;
          } finally {
            prompt.close();
          }
        }
        if (options.auth !== undefined) {
          const parts = options.auth.split('=');
          if (
            parts.length !== 2 ||
            !authServices.includes(parts[0] ?? '') ||
            !/^[A-Z_][A-Z0-9_]*$/.test(parts[1] ?? '')
          )
            throw new ConfigurationError(
              'Expected a supported service and an environment variable NAME, such as github=GITHUB_TOKEN.',
            );
          config.auth[parts[0]!] = parts[1]!;
        }
        if (options.timeout !== undefined) config.timeout = options.timeout;
        if (options.retries !== undefined) config.retries = options.retries;
        if (options.enable !== undefined)
          config.enabledChannels = options.enable.split(',').filter(Boolean);
        if (options.prefer !== undefined) {
          const parts = options.prefer.split('=');
          if (parts.length !== 2 || !parts[0] || !parts[1])
            throw new ConfigurationError('Expected channel=backend.');
          config.preferredBackends[parts[0]] = parts[1];
        }
        // Validate channel/backend references before writing anything.
        new WebPulse(parseConfig(config));
        await store.save(config);
        output({
          path: store.path,
          config,
          message: 'Settings saved. Set credentials in your environment or secret manager.',
        });
      },
    );

  const channels = command(
    program,
    'channels',
    'Discover implemented capabilities; discovery does not imply health',
  );
  command(channels, 'list', 'List channels, operations and backend IDs').action(async () =>
    output((await pulse()).capabilities.list()),
  );
  const run = async (channel: string, operation: string, params: unknown) => {
    const instance = await pulse();
    try {
      output(
        instance.redactor.value(await instance.executeCapability({ channel, operation, params })),
      );
    } catch (error) {
      const safe = instance.error(error);
      io.err(JSON.stringify({ error: safe }));
      process.exitCode = 1;
    }
  };
  command(program, 'search <query>', 'Search through Exa keyless MCP, or REST with EXA_API_KEY')
    .option('--limit <count>', 'Result count', integer)
    .action((query: string, opts: { limit?: number }) => run('search', 'web', { query, ...opts }));
  command(
    program,
    'execute <channel> <operation> <params>',
    'Invoke a discovered capability with a JSON object',
  ).action(async (channel: string, operation: string, params: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(params);
    } catch {
      throw new ConfigurationError('Parameters must be valid JSON.');
    }
    await run(channel, operation, parsed);
  });
  const web = command(program, 'web', 'Read public websites');
  command(web, 'read <url>', 'Fetch and extract a public page')
    .option('--format <format>', 'text or markdown', 'markdown')
    .action((url: string, opts: { format: string }) =>
      run('web', 'read', { url, format: opts.format }),
    );
  const rss = command(program, 'rss', 'Read RSS and Atom feeds');
  command(rss, 'read <url>', 'Fetch a public feed')
    .option('--limit <count>', 'Entry count', integer)
    .action((url: string, opts: { limit?: number }) => run('rss', 'read', { url, ...opts }));
  const github = command(program, 'github', 'Use GitHub REST capabilities');
  command(github, 'search <query>', 'Search repositories')
    .option('--page <page>', 'Page number', integer)
    .option('--limit <count>', 'Page size', integer)
    .action((query: string, opts: object) =>
      run('github', 'searchRepositories', { query, ...opts }),
    );
  command(github, 'repository <owner> <repo>', 'Read repository details').action(
    (owner: string, repo: string) => run('github', 'getRepository', { owner, repo }),
  );
  for (const [name, op] of [
    ['issues', 'listIssues'],
    ['pulls', 'listPullRequests'],
  ] as const)
    command(github, `${name} <owner> <repo>`, `List repository ${name}`)
      .option('--page <page>', 'Page', integer)
      .option('--limit <count>', 'Page size', integer)
      .option('--state <state>', 'open, closed, or all', 'open')
      .action((owner: string, repo: string, opts: object) =>
        run('github', op, { owner, repo, ...opts }),
      );
  const youtube = command(program, 'youtube', 'Use official YouTube APIs');
  command(youtube, 'search <query>', 'Search videos (API credentials required)')
    .option('--limit <count>', 'Result count', integer)
    .option('--page-token <token>', 'Next page token')
    .action((query: string, opts: object) => run('youtube', 'search', { query, ...opts }));
  command(youtube, 'video <video>', 'Read video metadata').action((video: string) =>
    run('youtube', 'getVideo', { video }),
  );
  command(
    youtube,
    'transcript <video>',
    'Download captions for a video you can edit (OAuth required)',
  )
    .option('--language <language>', 'Caption language', 'en')
    .action((video: string, opts: object) => run('youtube', 'getTranscript', { video, ...opts }));
  const reddit = command(program, 'reddit', 'Use approved Reddit OAuth');
  command(reddit, 'search <query>', 'Search posts')
    .option('--subreddit <name>', 'Limit to subreddit')
    .option('--limit <count>', 'Result count', integer)
    .option('--after <cursor>', 'Pagination cursor')
    .action((query: string, opts: object) => run('reddit', 'search', { query, ...opts }));
  command(reddit, 'post <id>', 'Read one post').action((id: string) =>
    run('reddit', 'getPost', { id }),
  );
  const twitter = command(program, 'twitter', 'Use official X API (access plan required)');
  command(twitter, 'search <query>', 'Search recent posts')
    .option('--limit <count>', 'Result count (10–100)', integer)
    .option('--next-token <token>', 'Pagination token')
    .action((query: string, opts: object) => run('twitter', 'search', { query, ...opts }));
  command(twitter, 'post <id>', 'Read one post').action((id: string) =>
    run('twitter', 'getPost', { id }),
  );
  const linkedin = command(program, 'linkedin', 'Consenting LinkedIn identity only');
  command(linkedin, 'profile', 'Read your own OIDC profile').action(() =>
    run('linkedin', 'getProfile', {}),
  );
  const v2ex = command(program, 'v2ex', 'Public V2EX API');
  command(v2ex, 'hot', 'List hot topics')
    .option('--limit <count>', 'Count', integer)
    .action((opts: object) => run('v2ex', 'getHotTopics', opts));
  command(v2ex, 'node <node>', 'List node topics')
    .option('--page <page>', 'Page', integer)
    .action((node: string, opts: object) => run('v2ex', 'getNodeTopics', { node, ...opts }));
  command(v2ex, 'topic <id>', 'Read topic and replies')
    .option('--page <page>', 'Reply page', integer)
    .action((id: string, opts: object) => run('v2ex', 'getTopic', { id: integer(id), ...opts }));
  command(v2ex, 'user <username>', 'Read member profile').action((username: string) =>
    run('v2ex', 'getUser', { username }),
  );
  const mcp = command(program, 'mcp', 'Model Context Protocol');
  command(mcp, 'start', 'Start stdio server; stdout contains protocol messages only').action(
    async () => {
      const { startStdioServer } = await import('../mcp/server.js');
      await startStdioServer(await pulse());
    },
  );
  return program;
}
export async function runCli(args = process.argv, io: CliIO = defaultIO, supplied?: WebPulse) {
  try {
    await createProgram(io, supplied).parseAsync(args);
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.exitCode === 0) return;
      io.err(
        JSON.stringify({
          error: { code: 'VALIDATION', message: 'Invalid CLI arguments. Run webpulse --help.' },
        }),
      );
      process.exitCode = 2;
      return;
    }
    io.err(JSON.stringify({ error: publicError(error) }));
    process.exitCode = 1;
  }
}
