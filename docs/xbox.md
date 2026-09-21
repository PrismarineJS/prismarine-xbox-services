# Xbox client and sessions

`createXboxClient(auth, { titleId, scid, templateName, timeout = 15000, cleanupTimeout = 5000 } = {})`
returns a plain client object. `auth` implements `getXboxToken()`, as prismarine-auth's Authflow does.
No sign-in or credential caching is implemented here.

## Profiles and discovery

- `getProfile(identifier = 'me', options)` accepts `'me'`, `{ xuid: '123' }`, or
  `{ gamertag: 'SomePlayer' }`. It returns `{ xuid, gamertag, displayName, avatarUrl }`.
  XUIDs are strings; optional profile fields can be absent due to service/privacy settings.
  Numeric gamertags are never interpreted as XUIDs.
- `getActivityHandles(xuid, options)` returns activity handles for the configured SCID.
  Each contains a `sessionRef`. Activity discovery needs only `scid`, not a session template.
- `getSession(name, options)` reads a raw session document.

Individual operation options are `{ timeout, signal }`. Profile/raw requests require no title
configuration; session methods require SCID/template, and invitations additionally need titleId.
Configure another client with the same Authflow when using a different title.

## Managed sessions

```js
const session = await xbox.createSession({
  name: 'optional-caller-name',
  properties: ({ profile }) => ({ custom: { owner: profile.xuid, ...worldMetadata } }),
  publishActivity: false,
  signal
})
session.on('error', handleFailure)
session.on('changed', (current, previous) => handleChange(current, previous))
await session.setActivity() // Publish only when the application is ready.
```

`createSession({ name, properties, publishActivity = false, timeout, signal } = {})` returns a
ready EventEmitter. Omit name to generate a UUID. Properties may be an object or an async
callback receiving the normalized owner profile. Joining uses
`joinSession(name, { publishActivity = false, timeout, signal } = {})` and returns the same API.

A session exposes:

- `name`, `state`, and `snapshot`: read-only properties. `snapshot` is a defensive copy of the
  most recently fetched document, initialized before the factory resolves.
- `get(options)`: fetch a fresh snapshot, update the cache and emit changes.
- `updateProperties(properties, options)`: write only the properties section, then refresh.
  The package never interprets custom game properties or overwrites its own membership fields.
- `setActivity(options)`: publish this session as the user's activity. Successful publication
  enables republication on reconnect. Creation/joining alone never publishes implicitly.
- `invite(identifier, options)`: accept the same explicit identifiers as getProfile. A known
  XUID avoids an unnecessary profile lookup.
- `close()`: idempotent, terminal teardown. Close RTA, cancel session work and attempt a bounded leave.

Events:

| Event | Arguments | Meaning |
| --- | --- | --- |
| `changed` | current, previous | The authoritative session document changed. |
| `memberJoin` | member | A XUID appears in the new snapshot. |
| `memberLeave` | member | A previously present XUID is absent. |
| `propertiesChanged` | properties | The session properties changed. |
| `error` | error | A background refresh/transport failure ended the session. |
| `close` | — | Local cleanup finished. |

Member payloads retain the service schema, including `constants.system.xuid`. These events do
not imply a profile/gamertag lookup. Snapshot differences are observed changes, not a complete
log of every intermediate join/leave. The initial snapshot does not emit joins for existing members.
Duplicate notifications with unchanged snapshots emit nothing. Snapshot/event objects are copies.

RTA notifications and resync trigger a refresh. Bursts coalesce, with another fetch if a
notification arrives during a read. Reconnection first updates the member connection ID, then
republishes activity only if requested, and refreshes the document. Explicit operations and
background refreshes are serialized so old reads cannot overwrite newer local results.

One deadline covers each complete operation, including time waiting for earlier session work.
Cancellation of startup does not cancel the shared Authflow or persist after successful startup.
Closing one session does not cancel other sessions or direct client requests. Cleanup has its
own deadline (cleanupTimeout); leave failures are best-effort and debug-logged. Cancellation
cannot undo a write already applied remotely.

## Raw requests

- `request(method, url, { data, headers, contractVersion, timeout, signal })` provides authenticated
  JSON access to trusted Xbox service URLs. Redirects are rejected.
- `updateSession(name, payload, options)`, `setActivity(name, options)`, and
  `sendInvite(name, xuid, options)` expose low-level document/handle operations.
- `abortPending()` cancels this client's current HTTP requests, including session requests,
  without preventing subsequent calls. Use session.close() to end a session.

Raw session writes can alter managed fields; the caller owns those consequences. For shared
fields requiring optimistic concurrency, use request() with the appropriate conditional headers.
Requests are not automatically retried. Large JSON numbers are preserved as strings. Empty
successful responses return undefined. HTTP failures are ServiceError instances.

Diagnostics: `DEBUG=prismarine-xbox-services:session`. See [references](references.md) for
session notification, template and synchronization requirements.
