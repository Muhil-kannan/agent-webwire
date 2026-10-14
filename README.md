# WebWire

**Connect AI Agents to the Web.**

A TypeScript toolkit for searching the web, reading public pages, and accessing
platform APIs through one SDK, CLI, or MCP server.

- **Start without keys:** public webpages, RSS, GitHub, V2EX, and Exa keyless search.
- **Use the interface you need:** typed JavaScript/TypeScript APIs, JSON CLI output,
  and discoverable MCP tools.
- **Control requests:** cancellation, timeouts, bounded responses, read retries,
  and backend diagnostics.
- **Extend with channels:** validated operation schemas and pluggable backends.

Requires Node.js 22.16+ and npm. Available on
[npm as `agent-webwire`](https://www.npmjs.com/package/agent-webwire).

New users: see [platform setup](#platform-setup) or the
[full platform guide](https://github.com/Muhil-kannan/agent-webwire/blob/main/docs/PLATFORM_GUIDE.md)
for credentials, commands, and supported operations.

## Installation

Install the SDK in your application:

```bash
npm install agent-webwire
```

Or install the CLI globally:

```bash
npm install -g agent-webwire
webwire --help
```

## Quick start

Try these commands after installing the CLI. They require no API keys:

```bash
webwire search "latest TypeScript developments" --limit 3 --json
webwire web read "https://example.com" --json
webwire github search "typescript" --limit 3 --json
webwire rss read "https://feeds.bbci.co.uk/news/rss.xml" --limit 3 --json
```

The package name is `agent-webwire` and the executable is `webwire`. In PowerShell,
use `npm.cmd` or `webwire.cmd` if the execution policy blocks a `.ps1` shim.

## Supported channels

Start with the [platform setup and usage guide](https://github.com/Muhil-kannan/agent-webwire/blob/main/docs/PLATFORM_GUIDE.md) for
credential setup, copyable commands, and platform-specific limitations.

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
and charges depend on the account. See
[authentication](https://github.com/Muhil-kannan/agent-webwire/blob/main/docs/AUTHENTICATION.md).

The website reader handles content returned by public HTTP servers. It does not
render JavaScript, extract PDFs, or solve access challenges. YouTube captions are
not available for arbitrary videos, and LinkedIn access is limited to your own
consenting identity. Other platform-specific integrations are not implemented.

## Platform setup

Each user provides their own credentials for the platforms that require them.
Installing WebWire does not create provider accounts or API keys. Websites, RSS,
public GitHub reads, V2EX, and default Exa web search need no key.

| Platform                             | Set this environment variable | Setup and examples                                                                                                                               |
| ------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| YouTube search / metadata            | `YOUTUBE_API_KEY`             | [Enable YouTube Data API v3 and create a Google API key](https://github.com/Muhil-kannan/agent-webwire/blob/main/docs/PLATFORM_GUIDE.md#youtube) |
| YouTube editable-video captions      | `YOUTUBE_ACCESS_TOKEN`        | [OAuth token and caption permissions](https://github.com/Muhil-kannan/agent-webwire/blob/main/docs/PLATFORM_GUIDE.md#captions-and-transcripts)   |
| X / Twitter                          | `X_BEARER_TOKEN`              | [Developer app, bearer token, and endpoint access](https://github.com/Muhil-kannan/agent-webwire/blob/main/docs/PLATFORM_GUIDE.md#x--twitter)    |
| Reddit                               | `REDDIT_ACCESS_TOKEN`         | [Approved Data API access and OAuth](https://github.com/Muhil-kannan/agent-webwire/blob/main/docs/PLATFORM_GUIDE.md#reddit)                      |
| GitHub private / authenticated reads | `GITHUB_TOKEN`                | [Repository access and read permissions](https://github.com/Muhil-kannan/agent-webwire/blob/main/docs/PLATFORM_GUIDE.md#github)                  |
| LinkedIn own profile                 | `LINKEDIN_ACCESS_TOKEN`       | [OIDC app and member consent](https://github.com/Muhil-kannan/agent-webwire/blob/main/docs/PLATFORM_GUIDE.md#linkedin)                           |
| Optional Exa REST account            | `EXA_API_KEY`                 | [REST key or default keyless search](https://github.com/Muhil-kannan/agent-webwire/blob/main/docs/PLATFORM_GUIDE.md#web-search-with-exa)         |

For example, set your Google API key in the same terminal that runs WebWire.
PowerShell:

```powershell
$env:YOUTUBE_API_KEY = "YOUR_YOUTUBE_API_KEY"
webwire doctor --channel youtube
webwire youtube search "AI tutorials" --limit 3 --json
```

macOS/Linux:

```bash
export YOUTUBE_API_KEY="YOUR_YOUTUBE_API_KEY"
webwire doctor --channel youtube
webwire youtube search "AI tutorials" --limit 3 --json
```

Use actual credentials through your environment or secret manager; the examples
contain placeholders. WebWire does not automatically load `.env` files. Default
variable names need no additional `configure` step. Custom names can be mapped
with `webwire configure --auth youtube=MY_YOUTUBE_KEY`; this stores the name,
not the credential value. SDK and MCP processes need the same credentials in
their own environment, and WebWire does not issue or refresh OAuth tokens.

YouTube transcript downloads require OAuth and video-edit permission; they do
not work for arbitrary public videos. If both YouTube credentials are set, OAuth
takes precedence. X endpoint access and provider charges depend on your account;
the CLI command is `webwire twitter`, including for X.

**Instagram is not implemented.** There is no Instagram CLI command, SDK method,
or MCP tool. Bilibili, Xiaohongshu, Douyin, and WeChat also have no dedicated
integration. See the [guide's supported-platform limits](https://github.com/Muhil-kannan/agent-webwire/blob/main/docs/PLATFORM_GUIDE.md#instagram-and-other-unimplemented-platforms).

## SDK

```typescript
import { WebWire } from 'agent-webwire';

const pulse = new WebWire({ timeout: 15000, retries: 2 });

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

`new WebWire()` uses constructor settings and environment credentials.
`await WebWire.fromConfig()` also loads saved settings, as the CLI does.
Use `pulse.error(error)` for a redacted structured error and `pulse.diagnostics`
for the last 100 backend attempts. Runtime-discovered plugin operations use
`executeCapability({ channel, operation, params })` with schema validation.

## CLI

```bash
webwire search "AI frameworks" --limit 5 --json
webwire web read "https://example.com" --format markdown --json
webwire github search "typescript" --limit 5 --json
webwire github repository octocat Hello-World
webwire github issues octocat Hello-World
webwire github pulls octocat Hello-World
webwire rss read "https://feeds.bbci.co.uk/news/rss.xml" --limit 5
webwire youtube search "AI tutorials"
webwire youtube transcript VIDEO_YOU_CAN_EDIT --language en
webwire reddit search "TypeScript" --subreddit typescript
webwire twitter search "AI agents" --limit 10
webwire v2ex hot
webwire linkedin profile
```

Use `webwire channels list --json` to discover capabilities and command-specific
`--help` for options. `webwire execute <channel> <operation> <JSON>` invokes a
discovered operation directly. Paginated methods expose page numbers or provider
cursors; one response does not necessarily contain every result.

JSON results go to stdout; errors go to stderr. Exit codes are 0 for success,
1 for operation/configuration failures, and 2 for invalid CLI syntax.

## Diagnostics and configuration

```bash
webwire doctor --channel search
webwire install --dry-run
webwire configure --show
webwire configure --auth github=GITHUB_TOKEN
webwire configure --timeout 15000 --retries 2
```

Doctor performs actual scoped read probes; a successful probe is not a guarantee
that every platform operation or account permission works. Probes consume provider
quota. `install` checks the runtime without installing system software.

Configuration stores settings and environment-variable names, not secret values.
Keep credentials in your environment or secret manager. Use `--config-dir` or
`WEBWIRE_CONFIG_DIR` to select a directory. The default `config.json` lives under
`%APPDATA%/webwire` on Windows, `~/Library/Application Support/webwire` on macOS,
or `$XDG_CONFIG_HOME/webwire` / `~/.config/webwire` on Linux.

## MCP and agent skills

Add WebWire to an MCP client's configuration:

```json
{
  "mcpServers": {
    "webwire": {
      "command": "webwire",
      "args": ["mcp", "start"]
    }
  }
}
```

For clients that cannot execute a Windows `.cmd` shim, use `node` as the command
and an absolute path to `dist/cli/index.js` before `mcp`, `start` in the arguments.

Tools include `webwire_search_web`, `webwire_web_read`,
`webwire_github_search`, `webwire_youtube_search`, `webwire_rss_read`, and
`webwire_doctor`. Discovering a tool does not imply that its credentials are set.
Results use structured `{ "data": ... }` content; failures set `isError` and return
a redacted error. Stdio stdout is reserved for protocol messages.

The [agent skill](https://github.com/Muhil-kannan/agent-webwire/blob/main/skills/webwire/SKILL.md) provides selection and recovery
instructions. Install it explicitly in your agent's supported skills directory;
WebWire never modifies another agent's configuration automatically.

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
inside them. See [SECURITY.md](https://github.com/Muhil-kannan/agent-webwire/blob/main/SECURITY.md) for the network and credential boundaries.

## Development

From a source checkout:

```bash
npm ci
npm test
npm run build
npm run release:verify
```

Run the built CLI with `node dist/cli/index.js --help`. To try a local package,
run `npm pack`, then install the generated `.tgz` with `npm install -g PATH_TO_TARBALL`
for the CLI, or `npm install PATH_TO_TARBALL` in a separate SDK consumer project.

Default tests use deterministic responses and require no credentials. Optional
live checks use `npm run test:live`; add `-- --search` to include keyless Exa search.
`npm run test:package` verifies an isolated tarball installation, SDK imports and
types, the CLI, and MCP stdio. CI targets Windows, Linux, and macOS on Node 22 and 24.

[Contributing](https://github.com/Muhil-kannan/agent-webwire/blob/main/CONTRIBUTING.md) · [Architecture](https://github.com/Muhil-kannan/agent-webwire/blob/main/docs/ARCHITECTURE.md) ·
[Authentication](https://github.com/Muhil-kannan/agent-webwire/blob/main/docs/AUTHENTICATION.md) · [Releasing](https://github.com/Muhil-kannan/agent-webwire/blob/main/docs/RELEASING.md)

[Platform setup and usage](https://github.com/Muhil-kannan/agent-webwire/blob/main/docs/PLATFORM_GUIDE.md)

## License and credits

MIT licensed. See [LICENSE](https://github.com/Muhil-kannan/agent-webwire/blob/main/LICENSE) and [dependency notices](https://github.com/Muhil-kannan/agent-webwire/blob/main/THIRD_PARTY_NOTICES.md).
Inspired by [Agent-Reach](https://github.com/Panniantong/Agent-Reach).
WebWire is an independent TypeScript implementation.
