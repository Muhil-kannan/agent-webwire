# WebWire architecture

One instance owns validated options, an HTTP client, channel registry,
backend manager and capability manager. Channels contain operation schemas and
independent backend objects. The catalog is shared by SDK, Commander CLI and
official MCP SDK registration. Native HTTP backends need no system tools.

Web search has two mutually exclusive modes: a configured Exa credential uses
`search-http` (REST); absent credentials use `search-mcp` (hosted keyless MCP).
The official MCP client negotiates the protocol and calls web_search_exa through
the same DNS/redirect/size/deadline guards. JSON and finite SSE responses are
bounded before SDK parsing. Only the fixed Exa endpoint is contacted; no OAuth
flow or credential forwarding occurs. SDK reconnection is disabled so core read
retry policy remains authoritative. MCP results are normalized to the REST-shaped
search contract; unexpected formats and provider errors are reported explicitly.

```text
Typed SDK / Commander CLI / MCP stdio
                 ↓
        validated capability catalog
                 ↓
 channel registry → backend manager → native fetch
                 ↓                       ↓
     structured diagnostic events   guarded DNS connector
```

An operation has Zod input/output contracts, description, and readOnly flag.
Backends declare supported operations, priority, availability, scoped health and
execute. Selection validates preferences, filters by operation and availability,
and records attempts. Transient errors retry with bounded backoff, then fall
back only for read-only operations. Auth, validation and rate limits do not
switch credentials. Side-effecting plugins execute once. SDK cancellation and
an overall deadline cover selection, retries and execution; HTTP adds a bounded
request deadline and response limit. HTTP errors never echo upstream bodies.

Default URL handling accepts public HTTP(S), only default ports, no userinfo.
An Undici dispatcher supplies a validated DNS lookup to native fetch. This
additional dependency closes the DNS check/use gap unavailable in the basic
Fetch interface. Redirects are manual and revalidated; cross-origin credentials
are stripped and HTTPS downgrades rejected. No private-network override is
exposed through CLI or MCP. Plugins and injected transports are trusted code.

Config stores only settings and environment variable names; it does not persist
credential values. Reads/writes reject symlink path components, writes use
private temporary files and atomic rename. Doctor/discovery never writes files.
User configuration is loaded explicitly with WebWire.fromConfig(); constructor
options are deterministic and do not access user disk. CLI uses fromConfig.

The README lists supported channels and their scope. Discovery never implies
health. Health includes the exact probe scope; one public endpoint cannot
certify an entire platform or a caption grant.
Transport construction is separate from MCP server creation for future reuse.
