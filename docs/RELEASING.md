# Releasing WebWire

Releases require explicit maintainer authorization. Builds, tests, and ordinary
pushes do not publish packages.

The npm package is `agent-webwire`; the GitHub repository is
[`Muhil-kannan/agent-webwire`](https://github.com/Muhil-kannan/agent-webwire).
The package exports `WebWire` and installs the `webwire` executable.

For the first release, log in to the intended npm account with `npm login`,
confirm it with `npm whoami`, and run `npm run release:verify`. Review
`npm publish --dry-run` before explicitly publishing with
`npm publish --access public --registry=https://registry.npmjs.org`.
Complete the interactive authentication prompt. A rejected name does not reserve
that name or publish a version; npm decides name acceptance during publication.
Verify a successful release with `npm view agent-webwire version` and
`npx --yes agent-webwire@0.1.0 --help`.

For subsequent releases using GitHub Actions:

1. Set the repository and maintainer metadata in `package.json`. Check npm package
   ownership/availability and update the package name consistently if necessary.
2. Run `npm ci` and `npm run release:verify`. Review the package contents, licenses,
   provider access requirements, and CI results across the supported OS/Node matrix.
   Run optional live checks separately; default tests must not require credentials.
3. Update the version and changelog, then tag the reviewed commit as
   `v<package-version>`.
4. Configure the real npm trusted publisher for the GitHub repository,
   `publish.yml` workflow, and `npm-release` environment. Use npm 11.5.1+ with a
   supported Node version. A first publication may need separate authorization
   before the package's publisher settings can be configured.
5. Protect the GitHub `npm-release` environment with required reviewers and tag
   restrictions. These account settings are not established by the workflow file.
6. Dispatch `Authorized npm release` on the version tag and enter `PUBLISH`.
   The workflow verifies the tag/version, reruns the checks, and publishes through
   OIDC with provenance.

Do not commit npm tokens. Consult the current
[npm trusted publishing guide](https://docs.npmjs.com/trusted-publishers/)
when configuring the release account.
