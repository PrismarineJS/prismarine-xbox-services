const { createJsonClient } = require('../http')
const { openSession } = require('./session')

function profilePath (identifier) {
  if (identifier === 'me') return 'me'
  if (typeof identifier?.xuid === 'string' && /^\d+$/.test(identifier.xuid) && identifier.gamertag === undefined) return `xuids(${identifier.xuid})`
  if (typeof identifier?.gamertag === 'string' && identifier.xuid === undefined) return `gt(${encodeURIComponent(identifier.gamertag)})`
  throw new TypeError('Expected me, { xuid }, or { gamertag }')
}

function createXboxClient (auth, options = {}) {
  options = { ...options }
  const http = createJsonClient(async () => {
    const token = await auth.getXboxToken('http://xboxlive.com')
    return { authorization: `XBL3.0 x=${token.userHash};${token.XSTSToken}`, 'accept-language': 'en-US' }
  }, { service: 'Xbox', timeout: options.timeout })

  function sessionRef (name) {
    for (const field of ['scid', 'templateName']) {
      if (!options[field]) throw new TypeError(`Xbox sessions require ${field}`)
    }
    return { scid: options.scid, templateName: options.templateName, name }
  }

  function sessionUrl (name) {
    const ref = sessionRef(name)
    return `https://sessiondirectory.xboxlive.com/serviceconfigs/${encodeURIComponent(ref.scid)}/sessionTemplates/${encodeURIComponent(ref.templateName)}/sessions/${encodeURIComponent(name)}`
  }

  function request (method, url, config = {}) {
    return http.request(method, { ...config, url })
  }

  async function getProfile (identifier = 'me', config = {}) {
    const settings = 'Gamertag,GameDisplayName,GameDisplayPicRaw'
    const response = await request('GET', `https://profile.xboxlive.com/users/${profilePath(identifier)}/settings?settings=${settings}`, { ...config, contractVersion: '2' })
    const profile = response.profileUsers[0]
    if (!profile) throw new Error('Xbox profile not found')
    const values = Object.fromEntries((profile.settings || []).map(setting => [setting.id, setting.value]))
    return { xuid: String(profile.id), gamertag: values.Gamertag, displayName: values.GameDisplayName, avatarUrl: values.GameDisplayPicRaw }
  }

  async function getActivityHandles (xuid, config = {}) {
    if (!options.scid) throw new TypeError('Xbox activity lookup requires scid')
    const response = await request('POST', 'https://sessiondirectory.xboxlive.com/handles/query?include=relatedInfo,customProperties', {
      ...config,
      data: { type: 'activity', scid: options.scid, owners: { people: { moniker: 'people', monikerXuid: xuid } } },
      contractVersion: '107'
    })
    return response.results
  }

  function sendHandle (data, config) {
    return request('POST', 'https://sessiondirectory.xboxlive.com/handles', { ...config, data, contractVersion: '107' })
  }

  const client = {
    request,
    abortPending: http.abortPending,
    getProfile,
    getActivityHandles,
    getSession: (name, config) => request('GET', sessionUrl(name), { ...config, contractVersion: '107' }),
    updateSession: (name, data, config) => request('PUT', sessionUrl(name), { ...config, data, contractVersion: '107' }),
    setActivity: (name, config) => sendHandle({ version: 1, type: 'activity', sessionRef: sessionRef(name) }, config),
    sendInvite (name, xuid, config) {
      if (!options.titleId) throw new TypeError('Xbox invitations require titleId')
      return sendHandle({ version: 1, type: 'invite', sessionRef: sessionRef(name), invitedXuid: xuid, inviteAttributes: { titleId: options.titleId } }, config)
    },
    createSession: config => open(true, config),
    joinSession: (name, config) => open(false, { ...config, name })
  }

  function open (create, config = {}) {
    sessionRef(config.name)
    if ((!create || config.name !== undefined) && (typeof config.name !== 'string' || !config.name)) throw new TypeError('Session name is required')
    return openSession(client, auth, options, create, config)
  }
  return client
}
module.exports = { createXboxClient }
