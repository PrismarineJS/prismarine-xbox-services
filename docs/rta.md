# Real Time Activity

```js
const { connectRta } = require('prismarine-xbox-services')
const rta = await connectRta(auth, { timeout: 15000, signal })
rta.on('error', handleBackgroundFailure)
rta.on('resync', refreshServiceState)
const subscription = await rta.subscribe(resourceUri)
subscription.on('data', handleNotification)
subscription.on('ready', handleReplacementSubscription)
console.log(subscription.data)
// Later:
await subscription.close()
await rta.close()
```

`connectRta(auth, { timeout = 15000, signal } = {})` returns a connected Node EventEmitter.
It waits for credentials, nonce retrieval and WebSocket opening. Failed startup releases its
resources. Credentials come from auth.getXboxToken(); refresh policy belongs to that provider.

- `subscribe(uri, { timeout = 30000, signal } = {})` returns a subscription EventEmitter with
  read-only `uri`, `data` and `closed`, plus an idempotent `close()`.
- Subscription `data` events deliver resource notifications. `ready` reports replacement
  subscription data after reconnect; the original data is available when subscribe resolves.
- `reconnect({ timeout, signal } = {})` replaces the socket and restores subscriptions under
  one deadline. It resolves after restoration. Concurrent reconnect calls share the active attempt.
- `close()` terminates the connection and closes all subscriptions; it is idempotent and terminal.

Subscription objects and their listeners survive reconnects; request IDs and server subscription
IDs are private. Closing a subscription while reconnecting prevents its restoration. A late
subscription acknowledgment after cancellation triggers an unsubscribe.

Connection events: `resync`, `disconnect(code, reason)`, `error(error)` and terminal `close`.
Abnormal disconnect (1006), a missed heartbeat and 90-minute renewal trigger a reconnect.
Other disconnects permit an explicit reconnect. A failed background reconnect emits error;
there is no indefinite retry loop. New subscriptions while disconnected or reconnecting reject instead of being queued.

Explicit request failures reject their promises without duplicate error events. Register an
error listener for independent transport and background failures. Startup/operation signals
are scoped to that operation and are not retained as connection lifetime signals.

The transport uses Node's ws EventEmitter interface, per-connection pending requests and
abort signals. A ping/pong heartbeat detects an unresponsive connection. No token or nonce
URLs are logged. Tests exercise public methods over local sockets rather than calling
private protocol handlers. See [references](references.md).
