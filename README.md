# prismarine-xbox-services

[![Build Status](https://github.com/PrismarineJS/prismarine-xbox-services/actions/workflows/ci.yml/badge.svg)](https://github.com/PrismarineJS/prismarine-xbox-services/actions/workflows/ci.yml)

Xbox and PlayFab services API for Node.js.

## Status

This repository currently contains the package scaffold. The services implementation is being
extracted from the existing PrismarineJS projects; no service API is available here yet.
The initial API will be experimental while the extraction settles.

## Scope

The planned package provides:

- Xbox profiles, multiplayer sessions, invitations, and activity publishing.
- Xbox Real Time Activity (RTA) connections and subscriptions.
- PlayFab service operations through an isolated `PlayFabClient`, as concrete use cases are added.

Service clients will accept an existing [`prismarine-auth`](https://github.com/PrismarineJS/prismarine-auth)
Authflow for credentials. Sign-in, token acquisition, caching, and refresh remain in that package.
Minecraft-specific title configuration, world metadata, and protocol behavior belong to consumers.

The focus is services needed by Minecraft clients and bots, with reusable configuration for other
applications. This is not a commitment to implement every Xbox or PlayFab endpoint.

See the [architecture proposal](https://github.com/PrismarineJS/prismarine-auth/issues/185)
for package boundaries and the migration plan.

## Development

Use Node.js 22 or newer.

```sh
git clone https://github.com/PrismarineJS/prismarine-xbox-services.git
cd prismarine-xbox-services
npm install
npm test
```

`npm test` runs lint and tests. Use `npm run fix` to apply JavaScript Standard Style fixes.
See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution and release notes.

## License

[MIT](LICENSE)
