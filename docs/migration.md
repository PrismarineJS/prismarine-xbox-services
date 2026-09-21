# Experimental API changes

This package has no compatibility aliases. Update consumers to the current API directly.

| Previous API | Current API |
| --- | --- |
| `new XboxClient(auth, options)` | `createXboxClient(auth, options)` |
| `new PlayFabClient(credentials, options)` | `createPlayFabClient(credentials, options)` |
| `new XboxRTA(auth); await rta.connect(options)` | `await connectRta(auth, options)` |
| `profile.id` / raw profile settings | `profile.xuid`, `gamertag`, `displayName`, `avatarUrl` |
| Automatic activity publication on create/join | Explicit `{ publishActivity: true }` or `session.setActivity()` |
| RTA `close(code, reason)` notification | `disconnect(code, reason)`; `close` now means terminal local shutdown |
| `SessionDirectory` construction/inheritance | Client createSession/joinSession factories returning event emitters |
| `invitePlayer('123')` | `invite({ xuid: '123' })` or `invite({ gamertag: '123' })` |
| `getSessions(xuid)` | `getActivityHandles(xuid)` |
| Session `end()` / RTA `destroy()` | `close()` |
| RTA unsubscribe by numeric ID | `subscription.close()` |

Sessions now start with an authoritative snapshot. get() refreshes it; changed/memberJoin/
memberLeave/propertiesChanged events report observed differences. updateProperties() writes
and refreshes. Treat snapshot/event values as data; mutating them does not update the server.

Bedrock consumers retain title constants, world properties and Nethernet transport logic.
Replace the inherited adapter with a small factory around createSession({ properties,
publishActivity: true }). Use profile.xuid inside property callbacks and session.snapshot or
await session.get() to read the returned session document. Consumer migration is a separate PR.
