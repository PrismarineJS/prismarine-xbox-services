# prismarine-xbox-services

[![Build Status](https://github.com/PrismarineJS/prismarine-xbox-services/actions/workflows/ci.yml/badge.svg)](https://github.com/PrismarineJS/prismarine-xbox-services/actions/workflows/ci.yml)

Xbox and PlayFab services API for Node.js 22+. The API is experimental.

```js
const { createXboxClient } = require('prismarine-xbox-services')
const xbox = createXboxClient(auth, { titleId, scid, templateName })
const profile = await xbox.getProfile({ gamertag: 'SomePlayer' })

const session = await xbox.createSession({
  name: 'my-session',
  properties: { custom: worldMetadata },
  publishActivity: true
})
session.on('error', console.error)
session.on('changed', snapshot => console.log(snapshot.properties))
session.on('memberJoin', member => console.log(member.constants.system.xuid))
try {
  await session.invite({ xuid: profile.xuid })
  // Keep the session open for as long as the application needs it.
} finally {
  await session.close()
}
```

Supply an existing [prismarine-auth](https://github.com/PrismarineJS/prismarine-auth) Authflow.
Authentication and credential caching stay there. Title configuration, Minecraft world
metadata, and game protocol behavior stay with the caller.

- [`createXboxClient`](docs/xbox.md): profiles, activity discovery, invitations, and managed sessions.
- [`connectRta`](docs/rta.md): a connected Node event emitter with stable subscriptions.
- [`createPlayFabClient`](docs/playfab.md): a separate client for authenticated PlayFab requests.

Clients are plain objects. Sessions, RTA connections, and subscriptions are EventEmitters;
internal state is private to each instance. There are no compatibility aliases or runtime
prismarine-auth/Git dependencies. See the [migration guide](docs/migration.md) and
[protocol references](docs/references.md).

## Development

```sh
npm install
npm test
```

Tests include local WebSocket exchanges and mocked service responses; they need no live
credentials. Live Xbox/PlayFab integration still requires title-specific verification.
`npm test` runs lint, type checks and tests. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
