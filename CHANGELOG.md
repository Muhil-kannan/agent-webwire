# Changelog

## 0.1.0 — Unreleased

- Renamed the project to WebWire, npm package `agent-webwire`, SDK class
  `WebWire`, CLI `webwire`, and MCP tools `webwire_*`. Configuration now uses
  `WEBWIRE_CONFIG_DIR` and the `webwire` directory under the OS configuration path.

- Independent TypeScript SDK, Commander CLI and official MCP stdio server.
- Public website extraction, GitHub REST, RSS/Atom and credential-gated
  official YouTube, Reddit, X and LinkedIn own-profile operations; V2EX API.
- Exa search uses keyless hosted MCP without a credential, or authenticated REST
  with EXA_API_KEY. Both return the same structured SDK/CLI/MCP result contract.
- Validated plugin channels, controlled retries/fallback, scoped diagnostics,
  cancellation, guarded native Fetch and environment-reference configuration.
- Deterministic tests, package installation checks, cross-platform CI and a
  manually authorized npm trusted-publishing workflow.
- Restricted reference integrations are documented as unavailable or deferred.
