const { createJsonClient } = require('../http')

function createPlayFabClient (getCredentials, { titleId, timeout } = {}) {
  if (!/^[a-z0-9]+$/i.test(titleId || '')) throw new TypeError('PlayFab requires a titleId')
  if (typeof getCredentials !== 'function') throw new TypeError('PlayFab requires a credential provider')
  const http = createJsonClient(async config => {
    const credentials = await getCredentials()
    const entity = config.auth === 'entity'
    const token = entity ? credentials.EntityToken?.EntityToken : credentials.SessionTicket
    if (!token) throw new Error(`Missing PlayFab ${entity ? 'entity token' : 'session ticket'}`)
    return { [entity ? 'X-EntityToken' : 'X-Authorization']: token }
  }, { service: 'PlayFab', timeout })

  async function request (path, data = {}, options = {}) {
    if (!/^[A-Za-z]+\/[A-Za-z][A-Za-z0-9]*$/.test(path)) throw new TypeError('Expected a PlayFab API path such as Client/GetAccountInfo')
    if (options.auth !== undefined && !['session', 'entity'].includes(options.auth)) throw new TypeError('Unknown PlayFab authentication type')
    const response = await http.request('POST', { ...options, url: `https://${titleId}.playfabapi.com/${path}`, data })
    return response?.data
  }

  return {
    request,
    abortPending: http.abortPending,
    getTitleData: ({ keys } = {}, options) => request('Client/GetTitleData', { Keys: keys }, { ...options, auth: 'session' }),
    getUserInventory: options => request('Client/GetUserInventory', {}, { ...options, auth: 'session' }),
    executeCloudScript: ({ functionName, functionParameter, generatePlayStreamEvent, revisionSelection, specificRevision }, options) => request('Client/ExecuteCloudScript', {
      FunctionName: functionName,
      FunctionParameter: functionParameter,
      GeneratePlayStreamEvent: generatePlayStreamEvent,
      RevisionSelection: revisionSelection,
      SpecificRevision: specificRevision
    }, { ...options, auth: 'session' })
  }
}
module.exports = { createPlayFabClient }
