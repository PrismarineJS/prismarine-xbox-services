# Xbox Real Time Activity (experimental)

```js
const { XboxRTASocket } = require('prismarine-xbox-services')
const rta = new XboxRTASocket(auth)
rta.on('error', handleBackgroundFailure)
rta.on('resync', refreshAuthoritativeState)
try {
  await rta.init({ timeout: 15000, signal })
  const subscription = await rta.subscribe('https://sessiondirectory.xboxlive.com/connections/')
  console.log(subscription.initialData)
  subscription.on('data', handleNotification)
  subscription.on('ready', handleReplacementConnection)
  // Keep consuming notifications for as long as needed.
  await subscription.close()
} finally {
  await rta.close()
}
```

- `init({ timeout = 15000, signal } = {})` resolves once the WebSocket opens and existing subscriptions are restored. Its deadline
  covers credentials, nonce retrieval, handshake and restoration of existing subscriptions. The signal applies only to startup.
- `subscribe(uri, { timeout = 30000, signal } = {})` returns a stable XboxRTASubscription.
  Await connection first; disconnected requests reject instead of accumulating in a queue.
- `subscription.initialData` contains the response from the latest successful subscription handshake,
  replaced on reconnect rather than updated by notification events. `data` events carry change
  notifications; `ready` events report subsequent subscription responses after reconnect.
- Subscription identity and listeners survive reconnects. Wire IDs and sequence numbers are internal.
- `subscription.close()` is idempotent, removes local listeners from routing, and unsubscribes
  remotely when connected. It rejects if that remote request fails; the local subscription
  remains closed. A disconnected subscription is removed from future restoration.
- `close()` shuts down the connection and all its subscriptions. It is terminal and idempotent, emitting `close()` once after local cleanup.
- `reconnect()` explicitly replaces the connection and starts restoring subscriptions. Its
  promise resolves after all remaining subscriptions are restored; each subscription emits `ready`.
  Restoration shares the connection deadline configured by `init()`. A restoration failure
  rejects reconnect and releases the replacement connection. New subscriptions must wait for
  init/reconnect to finish.

Closure of an established remote connection emits `disconnect(code, reason)`. Normal closure permits later
explicit init/reconnect. Local close/reconnect does not emit `disconnect`; `close` is
reserved for the terminal `socket.close()` operation, even if never connected.
Abnormal close (1006) and 90-minute renewal initiate reconnection. Failed
background reconnect/restoration emits `error`; there is no unbounded retry loop. A `resync`
event tells callers to refresh authoritative service state.

Awaited request failures reject only; they are not also emitted as errors. Independent transport
failures still emit `error`, so callers need both an error listener and promise handling.
Authentication refresh decisions stay with the credential provider.

Diagnostics: `DEBUG=prismarine-xbox-services:rta`. Public members are documented above;
transport state and maps are implementation details. 

Socket state failures use exported error classes from `rta/constants.js`:
`SocketClosedError`, `SocketNotConnectedError`, and `SocketAlreadyConnectedError` all
extend `SocketError`. They can be caught with `instanceof`; their `name` matches the class.
`SocketAlreadyConnectedError` also covers a connection attempt already in progress.
An explicit reconnect rejects interrupted work with `SocketError`. Service failures,
timeouts and caller cancellation retain their existing errors/reasons.

`init()` performs asynchronous authentication, nonce acquisition and subscription setup.
Internally it calls `connect(nonce, signal)` to open the native WebSocket and attach the
class's `onSocketError`, `onSocketClose` and `onSocketMessage` handlers. Consumers should
call `init()` for complete setup rather than invoking the transport helper directly.

## Native WebSocket transport

The runtime uses Node 24's built-in WebSocket and fetch. `ws` is only a development dependency
for local test servers. Native WebSocket automatically answers server pings. The previous
pong-triggered watchdog has been removed: it never sent pings, and no server pong interval
was established. There is no active client heartbeat or guaranteed idle dead-connection
detection. Requests retain deadlines, and the socket renews every 90 minutes following
[Microsoft's RTA guidance](https://learn.microsoft.com/en-us/gaming/gdk/docs/services/fundamentals/rta/concepts/live-rta-best-practices).

`close()` immediately cancels local operations, clears timers and initiates native socket
closure. It does not wait for the peer's close handshake. Native WebSocket has no public
`terminate()` equivalent, so an unresponsive peer can leave the underlying connection closing
and potentially keep the process alive; the package cannot promise a transport teardown deadline.

RTA request failures expose `RTARequestError extends SocketError` with numeric `status` and
symbolic `code` (for example, `1001` / `Throttled`; unknown statuses use `Unknown`). The numeric
status is retained even if unknown. Nonce HTTP failures use `ServiceError` with service
`Xbox RTA`, HTTP `status` and response `body`.
