# Xbox clients (experimental)

Create an XboxClient from an existing prismarine-auth Authflow (or a compatible
`getXboxToken()` provider). Credentials and their refresh remain provider-owned.

```js
const { XboxClient } = require('prismarine-xbox-services')
const xbox = new XboxClient(auth, { titleId, scid, templateName })
const session = await xbox.createSession({
  properties: ({ profile }) => ({ custom: { owner: profile.id, ...worldMetadata } }),
  signal
})
session.on('error', handleError)
try {
  await session.invite({ xuid: friendXuid })
  await session.updateProperties({ custom: updatedMetadata })
  const document = await session.get()
} finally {
  await session.close()
}
```

## XboxClient

`new XboxClient(auth, { titleId, scid, templateName, timeout = 15000, cleanupTimeout = 5000 } = {})`.
Profiles and raw requests need no title configuration. Session operations require SCID and
template; invitations additionally require the title ID.

- `getProfile(identifier = 'me', options)`: accepts `'me'`, `{ xuid: '123' }`, or
  `{ gamertag: 'SomePlayer' }`. Numeric gamertags are never guessed to be XUIDs.
- `getActivityHandles(xuid, options)`: returns activity handles for the configured SCID,
  including their `sessionRef`; these are not full session documents.
- `createSession({ properties, timeout, signal } = {})`: creates membership and publishes
  activity, then returns a ready XboxSession. `properties` may be an object or an async
  `({ profile }) => properties` callback; Minecraft-specific properties belong in the caller.
- `joinSession(name, options)`: joins membership and publishes activity; returns the same
  XboxSession API. Obtain the session document with `session.get()` if needed.
- `getSession(name, options)`, `updateSession(name, payload, options)`: raw document operations.
- `setActivity(name, options)`, `sendInvite(name, xuid, options)`: raw handle operations.
- `request(method, url, { data, headers, contractVersion, timeout, signal })`: authenticated
  JSON request. Supply trusted Xbox service URLs; redirects are rejected.
- `abortPending()`: cancels current HTTP requests using this client, including managed sessions'
  HTTP requests. It does not close sessions or prevent future calls; use session.close() for teardown.

Options on individual operations are `{ timeout, signal }`. HTTP bodies preserve large numeric
IDs as strings, accept empty successful responses as undefined, and expose failures as
`ServiceError` with `service`, `status`, and raw `body`. Requests are not automatically retried.

## XboxSession

Instances come from the client factories. They expose `name`, read-only lifecycle `state`,
`get(options)`, `updateProperties(properties, options)`, `invite(identifier, options)` and `close()`.
Update payloads are wrapped in the session's `properties`; managed membership fields are not
part of this operation. Raw document updates remain available on XboxClient and require care
if they modify managed membership.

Each operation has one deadline covering all of its steps, including credentials, RTA startup,
property callbacks and HTTP bodies. A caller signal cancels that operation, not the lifetime
of a successfully returned session. Closing a session cancels its ongoing work through its own
lifetime signal; other sessions and direct client requests are unaffected.

`close()` is idempotent and terminal. It closes RTA, then attempts to leave if membership was
attempted. Cleanup has a separate deadline (`cleanupTimeout`); failed leave requests are
best-effort and debug-logged. Cancellation cannot undo a request already applied remotely.
A write that is observed completing after closure triggers another leave attempt.

Explicit operation failures reject their promises. Startup failures clean up before rejecting.
Background connection/refresh failures close the session and emit `error`; register a listener.
Reconnection updates are serialized and never overwrite application-owned properties.

Creation uses one membership PUT followed by activity publication. It no longer reads and
writes the same properties back. Microsoft's [MPSD overview](https://learn.microsoft.com/en-us/gaming/gdk/docs/services/multiplayer/mpsd/live-mpsd-overview)
describes session creation through the initial PUT; no requirement for the extra write was
identified. Live title-specific integration remains necessary to validate this behavior.

Diagnostics: `DEBUG=prismarine-xbox-services:session`. Fields prefixed with `_` are internal.
