# PlayFab client

```js
const { createPlayFabClient, ServiceError } = require('prismarine-xbox-services')
const playfab = createPlayFabClient(getCredentials, { titleId, timeout: 15000 })
const title = await playfab.getTitleData({ keys: ['ServerList'] })
const inventory = await playfab.getUserInventory()
const script = await playfab.executeCloudScript({
  functionName: 'SomeFunction',
  functionParameter: { example: true }
})
```

The credential callback returns or resolves to `{ SessionTicket, EntityToken: { EntityToken } }`.
Only the requested credential is required. It is called per request; the authentication provider
owns login, caching and refresh. Credentials must belong to the configured PlayFab title.

Current prismarine-auth getPlayfabLogin() is Minecraft Bedrock-specific. Passing
`() => auth.getPlayfabLogin()` is appropriate only with its matching title ID. Generic
PlayFab login remains separate prismarine-auth work.

## Endpoint helpers

- `getTitleData({ keys } = {}, options)`: Client/GetTitleData. Returns the service data, including `Data`.
- `getUserInventory(options)`: Client/GetUserInventory. Returns service data, including `Inventory`.
- `executeCloudScript({ functionName, functionParameter, generatePlayStreamEvent,
  revisionSelection, specificRevision }, options)`: Client/ExecuteCloudScript. Returns service data,
  including `FunctionResult` or a script-level `Error`. A script execution error in a successful
  HTTP response is not an HTTP failure; inspect the returned result.

Helper options are `{ timeout, signal }`. These helpers always use session-ticket authentication
(`X-Authorization`). GetUserInventory is PlayFab's legacy economy endpoint; this is not an
Economy v2 wrapper. Optional service fields remain in the response's original casing.

## Raw requests

`request(path, data = {}, { auth = 'session', timeout, signal } = {})` posts JSON and unwraps
the response's data. A path is `Client/GetAccountInfo`, never an arbitrary URL. Choose
`auth: 'entity'` to send X-EntityToken for entity APIs. There is no title-secret/admin API support.

Deadlines cover credentials, HTTP and body reading. abortPending() cancels current requests
without preventing future requests. Redirects and automatic retries are disabled. HTTP failures
are ServiceError instances with service, status and raw body; PlayFab errors also expose code,
errorCode and details. See [references](references.md) for the endpoint contracts.
