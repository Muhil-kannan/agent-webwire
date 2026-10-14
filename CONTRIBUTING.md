# Contributing

Use Node 22.16+ or Node 24 and npm. Run `npm ci`, then
`npm run release:verify`. Tests use deterministic responses and no paid keys.
`npm run test:live` is separate, needs a build and contacts public endpoints.

For a channel, define Zod input/output schemas, list its read-only operations,
provide an actual backend and a scoped read probe, and add SDK/CLI/MCP tests.
Document credential grants, API permissions, pagination and limitations. Mark
unsupported behavior explicitly. Do not add cookie import, challenge evasion,
shell interpolation, unlimited downloads or implicit credential fallback.

Use `WebWireOptions.channels` for plugin channels. Plugin code and custom fetch
implementations are trusted code. The core enforces deadlines and validation,
but cannot undo side effects of a plugin that ignores cancellation.

Run the formatter before submitting. Keep the lockfile updated and explain new
dependencies. The development esbuild override avoids GHSA-g7r4-m6w7-qqqr;
verify tsup and Vitest when changing it. tsup's declaration generator injects
baseUrl; its TypeScript 6 deprecation suppression is scoped to declaration builds.

Do not publish during contribution work. Releases require explicit maintainer
authorization and the protected workflow described in docs/RELEASING.md.
