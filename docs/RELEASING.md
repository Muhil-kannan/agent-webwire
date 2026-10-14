# Releasing WebPulse

Releases require explicit maintainer authorization. Builds, tests, and ordinary
pushes do not publish packages.

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
