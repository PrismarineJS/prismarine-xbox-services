# Migration from the initial extraction

This experimental API revision deliberately removes compatibility aliases before consumer migration.

| Initial API | Replacement |
| --- | --- |
| `new SessionDirectory(auth, title); await session.createSession(properties)` | `await new XboxClient(auth, title).createSession({ properties })` |
| `session.joinSession(name)` returning a document | `await xbox.joinSession(name)` returning an XboxSession; call `get()` for the document |
| `session.updateSession({ properties })` | `session.updateProperties(properties)` |
| `session.invitePlayer('123')` | `session.invite({ xuid: '123' })` or `{ gamertag: '123' }` |
| `session.end()` | `session.close()` |
| `xbox.getSessions(xuid)` | `xbox.getActivityHandles(xuid)` |
| `xbox.get/post/put/delete(url, options)` | `xbox.request(method, url, options)` |
| RTA wire response / subscription ID | Stable subscription object with `.initialData`, `data` / `ready` events and `.close()` |
| `rta.destroy()` / `rta.destroy(true)` | `rta.close()` / `rta.reconnect()` |
| PlayFab error `.error` / `.errorDetails` | `ServiceError.code` / `.details` |

For bedrock-protocol, keep Minecraft title defaults and world property construction in its
adapter, but replace inheritance with a factory that calls `xbox.createSession({ properties })`.
World discovery uses the client directly. Join callers obtain the document with `session.get()`.
The protocol's shutdown path calls `session.close()`. This package revision does not edit or
merge the Bedrock consumer PR or change prismarine-auth's APIs.

## Profile and managed-session changes

`getProfile()` now returns `{ xuid, gamertag, displayName, avatarUrl }`; replace `profile.id`
with `profile.xuid`, including property callbacks. Raw settings remain available via `request()`.
Creation accepts an optional `name`. Both creation and joining now read the initial snapshot,
available as `session.current`, and report subsequent changes through session events.
Call `await session.setActivity()` explicitly after creation/joining when activity publication
is desired; it is no longer automatic. Keep that call inside the consumer's cleanup scope.
The existing XboxClient, XboxSession, XboxRTASocket and PlayFabClient classes remain.

## RTA socket naming and Node version

Rename `XboxRTA` imports and constructors to `XboxRTASocket`; there is no compatibility alias.
Socket lifecycle failures now expose the error classes documented in [RTA](rta.md), so callers
can use `instanceof` instead of matching message text. Node.js 24 or newer is required.

`reconnect()` now waits for subscription restoration, not just socket opening. New subscriptions
must wait until it resolves. Native WebSocket replaces the runtime `ws` dependency; see
[RTA transport semantics](rta.md#native-websocket-transport) for the graceful shutdown limitation
and removal of the unverified pong watchdog.

Rename `RtaSubscription` to `XboxRTASubscription` and `subscription.data` to
`subscription.initialData`. The property holds the response from the latest subscription
handshake; the `data` event carries subsequent notifications. Listen for `disconnect(code,
reason)` to observe remote connection loss. The socket's `close` event now has no arguments
and is emitted once on terminal local shutdown, rather than on remote disconnection.

Use `await socket.connect(options)` for complete setup. Internally `_connectSocket(nonce, signal)`
opens the WebSocket and attaches class-bound event handlers; there is no separate initialization step.
