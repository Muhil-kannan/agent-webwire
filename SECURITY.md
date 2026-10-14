# Security

## Network and content boundaries

WebPulse accepts public HTTP(S) URLs on standard ports. The default transport
rejects private, loopback, link-local, reserved, and metadata addresses, validates
DNS answers inside the connection lookup, and checks every redirect. Standard
NAT64 addresses are checked against their embedded IPv4 destination.

Requests have deadlines, response-size limits, and a five-redirect limit.
Cross-origin redirects drop caller headers; HTTPS downgrades and API POST redirects
are refused. Exa keyless MCP is restricted to its fixed endpoint and refuses redirects.

HTML parsing does not execute scripts or load subresources. XML DTDs and custom
entities are rejected. Treat retrieved content as untrusted data. Consumers that
render Markdown as HTML should sanitize the rendered output.

## Credentials and configuration

Credentials stay in your environment or secret manager and are sent only to the
relevant provider. Configuration stores environment variable names rather than
tokens. Files use bounded reads, symlink checks, and atomic private writes; Windows
relies on the profile ACLs. Browser cookies and agent configuration are not read.

Errors omit upstream response bodies, request URLs, and headers. CLI and MCP output
redacts registered credentials. Authentication and quota failures do not silently
switch credentials or access modes. Only transient read operations are retried;
side-effecting plugin calls execute once.

## Embedding and extensions

Plugins and injected fetch/resolver implementations are trusted code and can
change the network guarantees. Cancellation cannot undo a plugin's external effects.
Embedding applications should enforce their own egress policy, quotas, and client
access controls. DNS filtering complements a firewall; it does not replace one.

Parsing is synchronous and size-bounded, not isolated in a resource-limited worker.
Text decoding assumes UTF-8. Configuration checks do not protect against an attacker
who can already replace the same user's directory tree. Keep that directory private.
Health checks are timestamped observations, and dependency audits are point-in-time
checks rather than guarantees.

## Reporting

Report vulnerabilities privately to the maintainer through the hosting repository's
private security advisory feature when available. Avoid publishing exploit details
or real credentials in public issues.
