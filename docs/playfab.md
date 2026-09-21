# PlayFab client (experimental)

`PlayFabClient` owns service requests, separate from Xbox endpoints. It has no Minecraft
constants or login implementation. Supply a title ID and a callback that obtains fresh
credentials from your authentication layer:

```js
const { PlayFabClient } = require('prismarine-xbox-services')
const playfab = new PlayFabClient(getCredentials, { titleId, timeout: 15000 })
const result = await playfab.request('Client/GetAccountInfo')
console.log(result.AccountInfo)
```

`getCredentials()` returns (or resolves to) `{ SessionTicket, EntityToken: { EntityToken } }`;
only the credential needed by the request is required. It is called for each request, so the
provider owns caching and refresh. In current prismarine-auth, `getPlayfabLogin()` is configured
specifically for Minecraft Bedrock: `() => auth.getPlayfabLogin()` is only appropriate with its
matching title ID. Generic title-aware login and the explicit Minecraft wrapper remain
separate prismarine-auth work; this package does not pretend that API already exists.

`request(path, data = {}, { auth = 'session', timeout, signal } = {})` posts JSON and returns
the response's `data`. Paths have the form `Client/GetAccountInfo`, not arbitrary URLs.
`auth: 'session'` sends `X-Authorization`; `auth: 'entity'` sends `X-EntityToken` for entity APIs.
The caller must choose the authentication type required by the endpoint. Credentials must
belong to the configured title. No title secret keys or admin/server APIs are provided.

The shared request deadline covers credentials, HTTP headers and body reading. `abortPending()`
cancels this client's current requests without disabling future requests. Redirects are rejected.
HTTP failures are `ServiceError` instances with `service`, `status` and raw `body`;
PlayFab error responses also expose `code`, `errorCode`, and `details`. No requests are automatically retried.

The initial surface is a generic transport. It does not claim that Minecraft needs PlayFab
activity/heartbeat calls or implement unverified Minecraft behavior.

Protocol references: Microsoft's [GetAccountInfo](https://learn.microsoft.com/en-us/rest/api/playfab/client/account-management/get-account-info?view=playfab-rest)
documents session-ticket authentication and the
[PlayFab REST API](https://learn.microsoft.com/en-us/rest/api/playfab/) documents endpoint-specific requirements.
