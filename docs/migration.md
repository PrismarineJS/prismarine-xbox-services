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
| RTA wire response / subscription ID | Stable subscription object with `.data`, `data` / `ready` events and `.close()` |
| `rta.destroy()` / `rta.destroy(true)` | `rta.close()` / `rta.reconnect()` |
| PlayFab error `.error` / `.errorDetails` | `ServiceError.code` / `.details` |

For bedrock-protocol, keep Minecraft title defaults and world property construction in its
adapter, but replace inheritance with a factory that calls `xbox.createSession({ properties })`.
World discovery uses the client directly. Join callers obtain the document with `session.get()`.
The protocol's shutdown path calls `session.close()`. This package revision does not edit or
merge the Bedrock consumer PR or change prismarine-auth's APIs.
