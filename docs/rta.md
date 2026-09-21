# Xbox Real Time Activity (experimental)

`XboxRTA` is included in this package. It accepts the same `getXboxToken()` provider as
`XboxClient`; it does not create a separate Authflow or credential cache.

```js
const { XboxRTA } = require('prismarine-xbox-services')
const rta = new XboxRTA(auth)
rta.on('error', console.error)
rta.on('event', event => console.log(event.subscriptionId, event.data))
rta.on('resync', () => { /* Re-fetch your authoritative service state. */ })
try {
  await rta.connect({ timeout: 15000 })
  const subscription = await rta.subscribe('https://sessiondirectory.xboxlive.com/connections/')
  console.log(subscription.data)
  // Keep the connection alive while consuming events.
  await rta.unsubscribe(subscription.subscriptionId)
} finally {
  await rta.destroy()
}
```

- `connect({ timeout = 15000, signal } = {})` resolves after WebSocket opening, with one
  deadline covering authentication, nonce retrieval and the handshake. Cancellation stops
  waiting for shared authentication without cancelling other consumers of that Authflow.
- `subscribe(uri)` returns `{ type, sequenceId, status, subscriptionId, data, uri }`.
- `unsubscribe(subscriptionId)` takes the numeric ID returned by subscribe, not its sequence ID.
- Subscription requests have a 30-second deadline. Shutdown rejects queued/pending requests.
- `destroy()` is idempotent and terminal. `destroy(true)` reconnects and restores subscriptions.
- Abnormal close (1006), heartbeat expiry, and the 90-minute connection renewal initiate
  reconnect. Other server closures emit `close(code, reason)` and allow a later explicit
  `connect()`. Reconnection failures emit `error`; there is no unbounded retry loop.
- Reconnection emits new `subscribe` responses. Subscription IDs can change; track the new
  response rather than retaining an old ID. Managed SessionDirectory updates membership for you.
- Events: `subscribe`, `unsubscribe`, `event`, `resync`, `close`, and `error`.
  Register an error listener and handle rejected operation promises.
- `subscriptions` is a map keyed by request sequence ID. Treat it as read-only.

Diagnostics: `DEBUG=prismarine-xbox-services:rta`. Tokens and nonce URLs are not logged.
See [provenance](provenance.md) for the incorporated upstream implementation and fixes.
