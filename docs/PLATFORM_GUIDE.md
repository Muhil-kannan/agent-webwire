# Platform setup and usage

This guide covers the built-in WebWire channels. Each user supplies their own
provider credentials and is responsible for the provider's access requirements
and quotas. WebWire does not issue tokens or refresh OAuth credentials.

## Start here

Use Node.js 22.16 or newer. Install the CLI with:

```bash
npm install -g agent-webwire
webwire --help
webwire channels list --json
```

From a source checkout, run `npm ci` and `npm run build`, then replace `webwire`
in the examples with `node dist/cli/index.js`. In Windows PowerShell, use
`npm.cmd` if the execution policy blocks `npm.ps1`.

| Platform                                                            | Available in WebWire                                   | Credential                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------- |
| Public websites                                                     | Read HTML/plain text and extract Markdown              | None                                                                  |
| Web search                                                          | Exa web results                                        | None by default; optional `EXA_API_KEY`                               |
| GitHub                                                              | Repositories, search, issues, pull requests            | Optional `GITHUB_TOKEN` for public reads; required for private access |
| RSS/Atom                                                            | Feed metadata and entries                              | None for public feeds                                                 |
| YouTube                                                             | Search and video metadata                              | `YOUTUBE_API_KEY` or `YOUTUBE_ACCESS_TOKEN`                           |
| YouTube captions                                                    | Available tracks on videos the OAuth identity can edit | `YOUTUBE_ACCESS_TOKEN` with caption permissions                       |
| X / Twitter                                                         | Recent search and individual posts                     | `X_BEARER_TOKEN` with endpoint access                                 |
| Reddit                                                              | Post search and individual posts                       | Approved OAuth `REDDIT_ACCESS_TOKEN`                                  |
| LinkedIn                                                            | The consenting member's own OIDC profile               | `LINKEDIN_ACCESS_TOKEN`                                               |
| V2EX                                                                | Public topics, replies, nodes, and member profiles     | None                                                                  |
| Instagram                                                           | Not implemented                                        | No supported setup                                                    |
| Bilibili, Xiaohongshu, Douyin, WeChat, and other unlisted platforms | No dedicated integration                               | No supported platform-specific setup                                  |

Discovery lists implemented operations, including those that still need
credentials. Run `webwire doctor --channel CHANNEL` to check a particular
channel. Doctor performs network requests and can consume provider quota.

## Set credentials in your environment

The credential examples below use PowerShell and placeholder values. Set actual
secrets through your shell or secret manager; do not commit them or put them in
shared command history. These assignments affect the current terminal and child
processes, not other terminals or already-running applications.

PowerShell:

```powershell
$env:YOUTUBE_API_KEY = "YOUR_YOUTUBE_API_KEY"
```

The equivalent for macOS/Linux shells is:

```bash
export YOUTUBE_API_KEY="YOUR_YOUTUBE_API_KEY"
```

WebWire reads environment variables from the process that launches it. It does
not automatically load `.env` files. If you use one, load it through your own
application/runtime and keep it out of Git. The SDK can also accept an `env`
object supplied by your secret manager.

Default variable names need no `webwire configure` command. To use a custom name:

```powershell
$env:MY_YOUTUBE_KEY = "YOUR_YOUTUBE_API_KEY"
webwire configure --auth youtube=MY_YOUTUBE_KEY
```

`configure --auth` stores the variable's **name**, not its value. See
[authentication and storage](AUTHENTICATION.md) for all names and config paths.

## YouTube

### Search and video metadata

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or
   select a project.
2. Open **APIs & Services → Library**, find **YouTube Data API v3**, and enable it.
3. Under **APIs & Services → Credentials**, create an API key. Restrict its API
   access to YouTube Data API v3 and use application restrictions compatible with
   the environment making requests.
4. Set the key and test from the same terminal:

```powershell
$env:YOUTUBE_API_KEY = "YOUR_YOUTUBE_API_KEY"
webwire doctor --channel youtube
webwire youtube search "AI tutorials" --limit 3 --json
webwire youtube video "https://www.youtube.com/watch?v=jNQXAC9IVRw" --json
```

Search returns an `items` array of video IDs and snippets; `nextPageToken` may
identify another page. Pass it with `--page-token TOKEN`. Search and metadata
requests have provider quotas; a successful metadata doctor probe does not
verify remaining search quota.

Follow [Google's setup guide](https://developers.google.com/youtube/v3/getting-started)
and [credential guide](https://developers.google.com/youtube/registering_an_application).

### Captions and transcripts

An API key alone cannot download captions. Obtain a valid OAuth access token
through Google's authorized flow with an appropriate scope, such as
`https://www.googleapis.com/auth/youtube.force-ssl`. The authenticated identity
must have permission to edit the requested video, and a matching caption track
must exist.

```powershell
$env:YOUTUBE_ACCESS_TOKEN = "YOUR_OAUTH_ACCESS_TOKEN"
webwire youtube transcript "YOUR_EDITABLE_VIDEO_ID" --language en --json
```

WebWire does not fetch arbitrary public-video transcripts. OAuth takes precedence
over the API key when both are set. An expired OAuth token must be refreshed by
your application, or removed if you want search to use the API key again.

See [Google's caption download permissions](https://developers.google.com/youtube/v3/docs/captions/download).

## X / Twitter

1. Follow [X's access setup](https://docs.x.com/x-api/getting-started/getting-access)
   to create a developer account and app in the developer console.
2. Obtain the app's bearer token. Confirm that the account has access to recent
   search and post lookup; provider charges and usage limits may apply.
3. Set the bearer token and run a search:

```powershell
$env:X_BEARER_TOKEN = "YOUR_X_BEARER_TOKEN"
webwire twitter search "AI agents" --limit 10 --json
webwire twitter post "YOUR_NUMERIC_POST_ID" --json
```

The CLI channel is named `twitter`, including for X. Search accepts 10–100
results per page; pass a returned `nextToken` with `--next-token TOKEN`.
`webwire doctor --channel twitter` also makes a recent-search request and can
consume account quota or incur charges. Posting, DMs, and account automation are
not implemented.

## Reddit

1. Obtain approved Reddit Data API access for your use case. Creating an app or
   having a Reddit account alone does not guarantee API access. Follow Reddit's
   current [access requirements](https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data)
   and [developer documentation](https://www.reddit.com/dev/api/).
2. Obtain an OAuth access token using the flow authorized for your application.
   Search and post reads need suitable read access. The doctor probe also calls
   `/api/v1/me` and needs `identity` access.
3. Supply the OAuth **access token**, rather than an app client secret:

```powershell
$env:REDDIT_ACCESS_TOKEN = "YOUR_REDDIT_OAUTH_ACCESS_TOKEN"
webwire reddit search "TypeScript" --subreddit typescript --limit 5 --json
webwire reddit post "YOUR_BASE36_POST_ID" --json
```

Use the post's base36 ID, without a `t3_` prefix, for `reddit post`. Search returns
an `after` cursor for pagination; pass it with `--after CURSOR`. WebWire does not
perform OAuth login/refresh or fall back to anonymous endpoints. A failed
identity probe does not necessarily mean a read-only search token lacks all
search access.

## GitHub

Public repository reads work without a token:

```bash
webwire github search "typescript" --limit 5 --json
webwire github repository microsoft TypeScript --json
webwire github issues microsoft TypeScript --limit 5 --json
webwire github pulls microsoft TypeScript --limit 5 --json
```

For private repositories or authenticated public requests, open GitHub
**Settings → Developer settings → Personal access tokens → Fine-grained tokens**.
Create a token with an expiry, the required repository access, and minimum read
permissions for the operations you need. Private issue and pull-request reads
require the corresponding read permissions; organization approval may be needed.
See [GitHub's token guide](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).

```powershell
$env:GITHUB_TOKEN = "YOUR_GITHUB_TOKEN"
webwire github repository YOUR_OWNER YOUR_REPOSITORY --json
```

GitHub/VS Code browser sign-in does not automatically populate `GITHUB_TOKEN`.
The doctor uses a public-repository read and does not verify private access.

## LinkedIn

1. Create a LinkedIn developer app and request the **Sign In with LinkedIn using
   OpenID Connect** product under the app's Products tab.
2. Configure the OAuth redirect URL and complete the member-consent flow in your
   application. Request `openid` and `profile`; request `email` if needed.
3. Supply the resulting access token:

```powershell
$env:LINKEDIN_ACCESS_TOKEN = "YOUR_LINKEDIN_OAUTH_ACCESS_TOKEN"
webwire linkedin profile --json
```

This returns the consenting member's own profile through `/v2/userinfo`.
Other people's profiles, job search, and LinkedIn-wide search are not supported.
WebWire does not host an OAuth callback or mint/refresh access tokens. Follow
[LinkedIn's OIDC setup](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2)
and its linked OAuth flow.

## Web search with Exa

No credential is required for the default hosted MCP backend:

```bash
webwire search "latest TypeScript developments" --limit 3 --json
webwire doctor --channel search
```

This uses Exa's hosted service and its rate-limited keyless access. To use your
own REST account, obtain an API key through [Exa](https://exa.ai/docs/reference/search)
and set it before launching WebWire:

```powershell
$env:EXA_API_KEY = "YOUR_EXA_API_KEY"
webwire search "AI frameworks" --limit 3 --json
```

A configured key selects REST. Authentication, quota, and network errors on that
account do not silently switch to keyless access. To return to keyless mode with
the default variable name:

```powershell
Remove-Item Env:EXA_API_KEY -ErrorAction SilentlyContinue
```

See [Exa MCP authentication](https://exa.ai/docs/get-started/exa-mcp#authentication).

## Public websites, RSS, and V2EX

These require no credentials for their supported public endpoints:

```bash
webwire web read "https://example.com" --format markdown --json
webwire rss read "https://feeds.bbci.co.uk/news/rss.xml" --limit 5 --json
webwire v2ex hot --limit 5 --json
webwire v2ex node python --json
```

Website reading extracts returned HTML/plain text; it does not render JavaScript,
extract PDFs, or bypass login/access challenges. RSS supports RSS 2.0 and Atom.
V2EX supports public hot topics, node topics, individual topics with a page of
replies, and member profiles. It does not provide full-text search. Use
`webwire v2ex --help` to discover the `topic` and `user` commands.

## Instagram and other unimplemented platforms

There is no `webwire instagram` command, Instagram SDK property, or Instagram
MCP tool. Adding an Instagram token cannot enable an integration that is absent.
The same applies to other platforms without a registered channel, including
Bilibili, Xiaohongshu, Douyin, and WeChat.

For discovering indexed public links, you can try general web search:

```bash
webwire search "site:instagram.com TypeScript" --limit 3 --json
```

Results depend on the search provider's index. This is not an Instagram API and
does not guarantee profile, post, private-content, or media access. A dedicated
integration would require separate implementation and appropriate provider access.

## Use the same credentials in the SDK or MCP

Install the SDK with `npm install agent-webwire`. Environment
credentials work with the SDK as well as the CLI:

```javascript
import { WebWire } from 'agent-webwire';

const wire = new WebWire();
const results = await wire.youtube.search('AI tutorials', { limit: 3 });
console.log(results.items);
```

Use `await WebWire.fromConfig()` if the SDK should also load saved CLI settings
and custom credential-variable names. Each platform has methods on `wire.web`,
`wire.search`, `wire.github`, `wire.rss`, `wire.youtube`, `wire.twitter`,
`wire.reddit`, `wire.linkedin`, and `wire.v2ex`. Use `wire.capabilities.list()` to
discover operation names and descriptions. MCP tool discovery exposes input schemas.

For MCP, configure the client to launch `webwire mcp start`. The launched process
must receive the necessary environment variables through the client's supported
environment or secret configuration. Already-running desktop clients may need a
restart after environment changes. See the [README MCP example](../README.md#mcp-and-agent-skills).

## When something fails

| Error or symptom                     | What to check                                                                                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BACKEND_UNAVAILABLE`                | Required credential is missing, or no available backend supports the operation. Check the named channel, environment, and enabled-channel settings. |
| `AUTHENTICATION`                     | Token/key is expired, invalid, or rejected. Verify provider permissions and OAuth precedence; do not repeatedly retry the same credential.          |
| `RATE_LIMIT`                         | Provider quota or access allowance is exhausted. Honor any returned retry hint and check the provider dashboard.                                    |
| `UNSAFE_URL`                         | Private, loopback, metadata addresses, unsafe redirects, and unsupported ports are intentionally blocked.                                           |
| `NOT_FOUND`                          | The resource does not exist, is unavailable to your identity, or has no matching caption track.                                                     |
| Works in a terminal but fails in MCP | The MCP process may have a different environment, credential mapping, or saved configuration.                                                       |

Use `webwire configure --show` to inspect non-secret settings and
`webwire COMMAND --help` for input options. A doctor result describes the probe
shown in its output, not every operation on that platform. Default automated
tests mock providers; they do not certify live credentials or access grants.
