# Authentication and provider access

WebWire stores environment variable **names**, not secret values. Obtain
credentials directly from each provider; use your shell or secret manager to
inject them. No credentials go to a WebWire-operated server. Never put tokens
in positional CLI arguments, source files, issue reports or committed client
configuration. Existing OAuth access tokens are accepted; WebWire does not
perform browser login, token issuance or automatic refresh.

| Channel / config auth key | Default environment name | Required access                                                                                                                                                                |
| ------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub / github           | GITHUB_TOKEN             | Optional for public reads; fine-grained repository access/read permissions for private resources. Issue and PR access depend on grants.                                        |
| YouTube / youtube         | YOUTUBE_API_KEY          | Enable YouTube Data API v3 in the owning Google project, with suitable API restrictions/quota.                                                                                 |
| YouTube / youtubeOAuth    | YOUTUBE_ACCESS_TOKEN     | Valid OAuth access token; captions need youtube.force-ssl or partner scope and video-edit permission. OAuth takes precedence over API key; failure does not switch to the key. |
| Reddit / reddit           | REDDIT_ACCESS_TOKEN      | Approved Reddit Data API application, read scopes; doctor identity probe additionally needs identity. No assumption of self-service approval or anonymous access.              |
| X / twitter               | X_BEARER_TOKEN           | Developer project with entitlement to recent search/post lookup. Pricing and available grants are account-specific.                                                            |
| Exa / search              | EXA_API_KEY (optional)   | Without a key, hosted MCP uses Exa's rate-limited keyless tier. A configured key selects REST and your account quota. Doctor probes the selected mode.                         |
| LinkedIn / linkedin       | LINKEDIN_ACCESS_TOKEN    | Sign In with LinkedIn using OIDC enabled; openid/profile and optionally email scopes. Only the consenting identity's userinfo is retrieved.                                    |

Example for a custom environment name:

```bash
webwire configure --auth github=WORK_GITHUB_TOKEN
```

Use `webwire configure --show` to inspect settings; it never prints credential
values. POSIX config directory/file creation uses 0700/0600. Windows relies on
the user's profile ACLs. Symbolic-link path components are rejected. Existing
shared directories do not receive new ACLs automatically; choose a private
`WEBWIRE_CONFIG_DIR` if your OS profile configuration is unusual.

Read probes are documented per backend in doctor. A successful public GitHub
repository fetch cannot prove a private-repo grant; a YouTube metadata fetch
cannot prove caption-edit permission. Missing env values yield configuration
required; rejected credentials yield authentication errors. Rate limit errors
stop retries and expose Retry-After/reset hints when supplied by the provider.
GitHub search results are capped by its search window, and page sizes/provider
cursors are exposed explicitly; callers decide whether to request another page.

Provider documentation:

- [GitHub REST repository API](https://docs.github.com/en/rest/repos/repos#get-a-repository)
  and [rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).
- [YouTube search](https://developers.google.com/youtube/v3/docs/search/list),
  [captions list](https://developers.google.com/youtube/v3/docs/captions/list) and
  [caption download permissions](https://developers.google.com/youtube/v3/docs/captions/download).
- [Reddit API search and scopes](https://www.reddit.com/dev/api/#GET_search).
- [X recent search](https://docs.x.com/x-api/posts/search-recent-posts).
- [Exa search API](https://exa.ai/docs/reference/search).
- [LinkedIn OIDC userinfo](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2).

Quotas, approval criteria, pricing and terms change. No universal free-access
promise or hardcoded rate quota is made. Confirm current requirements in the
provider account before authorizing requests.

Exa keyless MCP requires no sign-in, API key, local server or additional system
tool. Queries go to `https://mcp.exa.ai/mcp` through WebWire's guarded transport
and the official MCP SDK. Setting the configured Exa key selects REST instead.
Authentication failures, exhausted quota and network failures on a configured
REST account do not fall back to anonymous access. To return to keyless mode,
remove the Exa credential from the environment used to launch WebWire.
See [Exa MCP authentication](https://exa.ai/docs/get-started/exa-mcp#authentication).
