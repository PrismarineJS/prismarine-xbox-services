# Xbox Real Time Activity (experimental)

```js
const { XboxRTASocket } = require('prismarine-xbox-services')
const rta = new XboxRTASocket(auth)
rta.on('error', handleBackgroundFailure)
rta.on('resync', refreshAuthoritativeState)
try {
  await rta.connect({ timeout: 15000, signal })
  const subscription = await rta.subscribe('https://sessiondirectory.xboxlive.com/connections/')
  console.log(subscription.data)
  subscription.on('data', handleNotification)
  subscription.on('ready', handleReplacementConnection)
  // Keep consuming notifications for as long as needed.
  await subscription.close()
} finally {
  await rta.close()
}
```

- `connect({ timeout = 15000, signal } = {})` resolves once the WebSocket opens. Its deadline
  covers credentials, nonce retrieval and handshake. The signal applies only to startup.
- `subscribe(uri, { timeout = 30000, signal } = {})` returns a stable RtaSubscription.
  Await connection first; disconnected requests reject instead of accumulating in a queue.
- `subscription.data` contains the latest subscription response. `data` events carry change
  notifications; `ready` events report subsequent subscription responses after reconnect.
- Subscription identity and listeners survive reconnects. Wire IDs and sequence numbers are internal.
- `subscription.close()` is idempotent, removes local listeners from routing, and unsubscribes
  remotely when connected. It rejects if that remote request fails; the local subscription
  remains closed. A disconnected subscription is removed from future restoration.
- `close()` shuts down the connection and all its subscriptions. It is terminal and idempotent.
- `reconnect()` explicitly replaces the connection and starts restoring subscriptions. Its
  promise resolves at socket opening; each restored subscription emits `ready` when restored.

Normal server closure emits `close(code, reason)` and permits later explicit connect/reconnect.
Abnormal close (1006), heartbeat expiry, and 90-minute renewal initiate reconnection. Failed
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
