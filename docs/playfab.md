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

Convenience methods use the same request transport and accept `{ timeout, signal }` as
operation options:

```js
const titleData = await playfab.getTitleData({ keys: ['ServerList'] })
const inventory = await playfab.getUserInventory()
const result = await playfab.executeCloudScript({
  functionName: 'SomeFunction', functionParameter: {}, generatePlayStreamEvent: false
})
if (result.Error) console.error(result.Error.Message)
```

All three call PlayFab **Client** endpoints using `X-Authorization` session tickets, not
entity tokens. Responses retain PlayFab field names (`Data`, `Inventory`, `FunctionResult`,
`Error`). A CloudScript execution error inside a successful HTTP response stays in `Error`;
it is not an HTTP `ServiceError`. Use raw `request()` for additional service parameters.
`getUserInventory()` is the legacy Economy API, not Economy v2. These wrappers do not imply
that Minecraft needs activity/heartbeat calls or that these operations are enabled for every title.

References: [GetTitleData](https://learn.microsoft.com/en-us/rest/api/playfab/client/title-wide-data-management/get-title-data?view=playfab-rest),
[GetUserInventory](https://learn.microsoft.com/en-us/rest/api/playfab/client/player-item-management/get-user-inventory?view=playfab-rest),
[ExecuteCloudScript](https://learn.microsoft.com/en-us/rest/api/playfab/client/server-side-cloud-script/execute-cloud-script?view=playfab-rest).

Protocol references: Microsoft's [GetAccountInfo](https://learn.microsoft.com/en-us/rest/api/playfab/client/account-management/get-account-info?view=playfab-rest)
documents session-ticket authentication and the
[PlayFab REST API](https://learn.microsoft.com/en-us/rest/api/playfab/) documents endpoint-specific requirements.
