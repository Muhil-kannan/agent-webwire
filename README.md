# WebPulse

**Connect AI Agents to the Web.**

A TypeScript toolkit for searching the web, reading public pages, and accessing
platform APIs through one SDK, CLI, or MCP server.

- **Start without keys:** public webpages, RSS, GitHub, V2EX, and Exa keyless search.
- **Use the interface you need:** typed JavaScript/TypeScript APIs, JSON CLI output,
  and discoverable MCP tools.
- **Control requests:** cancellation, timeouts, bounded responses, read retries,
  and backend diagnostics.
- **Extend with channels:** validated operation schemas and pluggable backends.

Requires Node.js 22.16+ and npm. This package is currently an unpublished prerelease.

## Quick start

From this checkout:

```bash
npm ci
npm run build
node dist/cli/index.js search "latest TypeScript developments" --limit 3 --json
node dist/cli/index.js web read "https://example.com" --json
```

In PowerShell, use `npm.cmd` if the execution policy blocks `npm.ps1`.

To install the CLI globally from a local build:

```bash
npm pack
npm install -g ./web-pulse-0.1.0.tgz
webpulse --help
```

For SDK use, install that tarball in your application's directory with
`npm install /path/to/web-pulse-0.1.0.tgz`. After publication, the package name
will be `web-pulse` and the executable will remain `webpulse`.

## Supported channels

| Channel   | Capabilities                                              | Authentication                                                              |
| --------- | --------------------------------------------------------- | --------------------------------------------------------------------------- |
| Web       | Public HTML/plain text, titles, metadata, Markdown        | None for public pages                                                       |
| Search    | Exa web search                                            | Keyless MCP by default; optional API key for REST                           |
| GitHub    | Repositories, search, issues, pull requests               | Optional token for public reads; required for private access                |
| RSS       | RSS 2.0 and Atom feeds                                    | None for public feeds                                                       |
| YouTube   | Search, video metadata, available editable-video captions | API key or OAuth; caption downloads require OAuth and video-edit permission |
| Reddit    | Search and post details                                   | Approved OAuth access token                                                 |
| Twitter/X | Recent search and post details                            | Bearer token with endpoint access                                           |
| V2EX      | Hot topics, node topics, topic/replies, member profiles   | None                                                                        |
| LinkedIn  | Consenting user's own profile                             | OIDC access token                                                           |

Keyless search uses Exa's hosted service and is subject to its rate limits.
When an Exa key is configured, search uses your REST account instead; failures
never silently switch to anonymous access. Other provider permissions, quotas,
and charges depend on the account. See [authentication](docs/AUTHENTICATION.md).

The website reader handles content returned by public HTTP servers. It does not
render JavaScript, extract PDFs, or solve access challenges. YouTube captions are
not available for arbitrary videos, and LinkedIn access is limited to your own
consenting identity. Other platform-specific integrations are not implemented.

## SDK

```typescript
import { WebPulse } from 'web-pulse';

const pulse = new WebPulse({ timeout: 15000, retries: 2 });

const results = await pulse.search.web('TypeScript frameworks', { limit: 5 });
const page = await pulse.web.read('https://example.com');
const repositories = await pulse.github.searchRepositories('AI agents');
const feed = await pulse.rss.read('https://feeds.bbci.co.uk/news/rss.xml');

console.log(results.results, page.title, repositories.items, feed.entries);
```

Use the generic typed API or discover operations at runtime:

```typescript
await pulse.execute({
  channel: 'github',
  operation: 'getRepository',
  params: { owner: 'octocat', repo: 'Hello-World' },
});

console.log(pulse.capabilities.list());
```

Pass cancellation/deadline options as the last method argument:

```typescript
await pulse.web.read(
  'https://example.com',
  { format: 'text' },
  {
    signal: AbortSignal.timeout(5000),
  },
);
```

`new WebPulse()` uses constructor settings and environment credentials.
`await WebPulse.fromConfig()` also loads saved settings, as the CLI does.
Use `pulse.error(error)` for a redacted structured error and `pulse.diagnostics`
for the last 100 backend attempts. Runtime-discovered plugin operations use
`executeCapability({ channel, operation, params })` with schema validation.

## CLI

```bash
webpulse search "AI frameworks" --limit 5 --json
webpulse web read "https://example.com" --format markdown --json
webpulse github search "typescript" --limit 5 --json
webpulse github repository octocat Hello-World
webpulse github issues octocat Hello-World
webpulse github pulls octocat Hello-World
webpulse rss read "https://feeds.bbci.co.uk/news/rss.xml" --limit 5
webpulse youtube search "AI tutorials"
webpulse youtube transcript VIDEO_YOU_CAN_EDIT --language en
webpulse reddit search "TypeScript" --subreddit typescript
webpulse twitter search "AI agents" --limit 10
webpulse v2ex hot
webpulse linkedin profile
```

Use `webpulse channels list --json` to discover capabilities and command-specific
`--help` for options. `webpulse execute <channel> <operation> <JSON>` invokes a
discovered operation directly. Paginated methods expose page numbers or provider
cursors; one response does not necessarily contain every result.

JSON results go to stdout; errors go to stderr. Exit codes are 0 for success,
1 for operation/configuration failures, and 2 for invalid CLI syntax.

## Diagnostics and configuration

```bash
webpulse doctor --channel search
webpulse install --dry-run
webpulse configure --show
webpulse configure --auth github=GITHUB_TOKEN
webpulse configure --timeout 15000 --retries 2
```

Doctor performs actual scoped read probes; a successful probe is not a guarantee
that every platform operation or account permission works. Probes consume provider
quota. `install` checks the runtime without installing system software.

Configuration stores settings and environment-variable names, not secret values.
Keep credentials in your environment or secret manager. Use `--config-dir` or
`WEBPULSE_CONFIG_DIR` to select a directory. The default `config.json` lives under
`%APPDATA%/webpulse` on Windows, `~/Library/Application Support/webpulse` on macOS,
or `$XDG_CONFIG_HOME/webpulse` / `~/.config/webpulse` on Linux.

## MCP and agent skills

Add WebPulse to an MCP client's configuration:

```json
{
  "mcpServers": {
    "webpulse": {
      "command": "webpulse",
      "args": ["mcp", "start"]
    }
  }
}
```

For clients that cannot execute a Windows `.cmd` shim, use `node` as the command
and an absolute path to `dist/cli/index.js` before `mcp`, `start` in the arguments.

Tools include `webpulse_search_web`, `webpulse_web_read`,
`webpulse_github_search`, `webpulse_youtube_search`, `webpulse_rss_read`, and
`webpulse_doctor`. Discovering a tool does not imply that its credentials are set.
Results use structured `{ "data": ... }` content; failures set `isError` and return
a redacted error. Stdio stdout is reserved for protocol messages.

The [agent skill](skills/webpulse/SKILL.md) provides selection and recovery
instructions. Install it explicitly in your agent's supported skills directory;
WebPulse never modifies another agent's configuration automatically.

## Troubleshooting and security

- **BACKEND_UNAVAILABLE:** check connectivity, `doctor`, and required credentials.
- **AUTHENTICATION:** correct the credential or grant; OAuth refresh is caller-managed.
- **RATE_LIMIT:** honor `retryAfterMs` when supplied and check provider quota.
- **UNSAFE_URL:** private/local networks, metadata addresses, unusual ports, and
  unsafe redirects are intentionally blocked.
- **INVALID_RESPONSE:** investigate a provider schema change or unsupported content.

Transient read operations retry within the configured deadline. Authentication,
validation, malformed responses, and quota errors stop immediately. Environment
HTTP proxies are not automatically used.

Retrieved pages, posts, and snippets are untrusted data, including any instructions
inside them. See [SECURITY.md](SECURITY.md) for the network and credential boundaries.

## Development

```bash
npm ci
npm test
npm run build
npm run release:verify
```

Default tests use deterministic responses and require no credentials. Optional
live checks use `npm run test:live`; add `-- --search` to include keyless Exa search.
`npm run test:package` verifies an isolated tarball installation, SDK imports and
types, the CLI, and MCP stdio. CI targets Windows, Linux, and macOS on Node 22 and 24.

[Contributing](CONTRIBUTING.md) · [Architecture](docs/ARCHITECTURE.md) ·
[Authentication](docs/AUTHENTICATION.md) · [Releasing](docs/RELEASING.md)

## License and credits

MIT licensed. See [LICENSE](LICENSE) and [dependency notices](THIRD_PARTY_NOTICES.md).
Inspired by [Agent-Reach](https://github.com/Panniantong/Agent-Reach).
WebPulse is an independent TypeScript implementation.
