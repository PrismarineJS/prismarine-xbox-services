# Contributing

Open issues and pull requests at
[PrismarineJS/prismarine-xbox-services](https://github.com/PrismarineJS/prismarine-xbox-services).
Pull requests target `main`.

## Checks

Install dependencies with `npm install`, then run `npm test`. CI checks Node.js 22 and 24.
Use JavaScript Standard Style. Add regression coverage for service behavior and lifecycle
changes; automated tests should not require live Xbox accounts or credentials.

Keep authentication in prismarine-auth, Xbox and PlayFab service clients separate, and
Minecraft-specific defaults in consumers. Document public APIs alongside their implementation.

## Releases

Publishing follows the PrismarineJS workflow: pushes to `main` run `npm-publish`,
which publishes new package versions and creates the corresponding GitHub release.
The maintainer will configure the `NPM_AUTH_TOKEN` repository secret when publishing is ready.
Update the package version and changelog together, and check `npm test` and
`npm pack --dry-run` before releasing.
