const { randomUUID } = require('node:crypto')
const { EventEmitter } = require('node:events')
const { isDeepStrictEqual } = require('node:util')
const rtaService = require('../rta')
const { operation } = require('../operation')
const debug = require('debug')('prismarine-xbox-services:session')

function membersByXuid (document) {
  return new Map(Object.values(document?.members || {}).filter(Boolean)
    .filter(member => member.constants?.system?.xuid !== undefined)
    .map(member => [String(member.constants.system.xuid), member]))
}

async function openSession (client, auth, defaults, create, options) {
  const session = new EventEmitter()
  const name = options.name ?? randomUUID()
  const lifetime = new AbortController()
  let state = 'opening'
  let rta
  let snapshot
  let membershipAttempted = false
  let activityPublished = false
  let nextConnection
  let dirty = false
  let refreshing
  let closing
  let queue = Promise.resolve()

  function save (document) {
    const previous = snapshot
    snapshot = structuredClone(document)
    if (!previous || isDeepStrictEqual(previous, snapshot)) return
    const next = snapshot
    queueMicrotask(() => {
      if (state !== 'open') return
      session.emit('changed', structuredClone(next), structuredClone(previous))
      const before = membersByXuid(previous)
      const after = membersByXuid(next)
      for (const [xuid, member] of after) if (!before.has(xuid)) session.emit('memberJoin', structuredClone(member))
      for (const [xuid, member] of before) if (!after.has(xuid)) session.emit('memberLeave', structuredClone(member))
      if (!isDeepStrictEqual(previous.properties, next.properties)) session.emit('propertiesChanged', structuredClone(next.properties))
    })
  }

  async function read (config) {
    const document = await client.getSession(name, config)
    config.signal.throwIfAborted()
    save(document)
    return structuredClone(snapshot)
  }

  async function leave () {
    await client.updateSession(name, { members: { me: null } }, { timeout: defaults.cleanupTimeout ?? 5000 })
      .catch(error => debug('Failed to leave %s: %s', name, error.message))
  }

  async function write (payload, config) {
    await client.updateSession(name, payload, config)
    if (lifetime.signal.aborted) await leave()
    config.signal.throwIfAborted()
  }

  function run (task, config = {}) {
    if (state !== 'open') return Promise.reject(new Error('Xbox session is not open'))
    const timeout = config.timeout ?? defaults.timeout ?? 15000
    return operation(signal => {
      const result = queue.then(() => {
        signal.throwIfAborted()
        return task({ signal, timeout })
      })
      queue = result.catch(() => {})
      return result
    }, { signal: config.signal, timeout }, lifetime.signal)
  }

  async function refresh (config) {
    do {
      dirty = false
      if (nextConnection) {
        const connection = nextConnection
        nextConnection = undefined
        await write({ members: { me: { properties: { system: { active: true, connection } } } } }, config)
        if (activityPublished) await client.setActivity(name, config)
      }
      await read(config)
    } while (dirty || nextConnection)
  }

  function notify () {
    dirty = true
    if (state !== 'open' || refreshing) return
    refreshing = run(refresh).catch(fail).finally(() => {
      refreshing = undefined
      if (dirty && state === 'open') notify()
    })
  }

  function close () {
    if (closing) return closing
    state = 'closing'
    lifetime.abort(new Error('Xbox session is closed'))
    closing = (async () => {
      await rta?.close()
      if (membershipAttempted) await leave()
      state = 'closed'
      session.emit('close')
    })()
    return closing
  }

  function fail (error) {
    if (state === 'closed' || state === 'closing') return
    const established = state === 'open'
    lifetime.abort(error)
    close().then(() => { if (established) queueMicrotask(() => session.emit('error', error)) })
  }

  Object.assign(session, {
    get: config => run(read, config),
    updateProperties: (properties, config) => run(async request => {
      await write({ properties }, request)
      await read(request)
    }, config),
    setActivity: config => run(async request => {
      await client.setActivity(name, request)
      activityPublished = true
    }, config),
    invite: (identifier, config) => run(async request => {
      const xuid = typeof identifier?.xuid === 'string' && /^\d+$/.test(identifier.xuid) && identifier.gamertag === undefined
        ? identifier.xuid
        : (await client.getProfile(identifier, request)).xuid
      request.signal.throwIfAborted()
      await client.sendInvite(name, xuid, request)
    }, config),
    close
  })
  Object.defineProperties(session, {
    name: { value: name, enumerable: true },
    state: { get: () => state, enumerable: true },
    snapshot: { get: () => structuredClone(snapshot), enumerable: true }
  })

  try {
    const timeout = options.timeout ?? defaults.timeout ?? 15000
    await operation(async signal => {
      const config = { signal, timeout }
      const profile = await client.getProfile('me', config)
      rta = await rtaService.connectRta(auth, config)
      rta.on('error', fail)
      rta.on('disconnect', (code, reason) => { if (code !== 1006) fail(new Error(`Xbox RTA disconnected: ${code} ${reason}`)) })
      rta.on('resync', notify)
      const subscription = await rta.subscribe('https://sessiondirectory.xboxlive.com/connections/', config)
      signal.throwIfAborted()
      subscription.on('data', notify)
      subscription.on('ready', data => { nextConnection = data.ConnectionId; notify() })
      const properties = typeof options.properties === 'function' ? await options.properties({ profile }) : options.properties
      signal.throwIfAborted()
      const payload = {
        members: {
          me: {
            constants: { system: { xuid: profile.xuid, initialize: true } },
            properties: { system: { active: true, connection: subscription.data.ConnectionId, subscription: { id: randomUUID(), changeTypes: ['everything'] } } }
          }
        }
      }
      if (create) payload.properties = properties || {}
      membershipAttempted = true
      await write(payload, config)
      if (options.publishActivity) {
        await client.setActivity(name, config)
        activityPublished = true
      }
      await refresh(config)
      signal.throwIfAborted()
      state = 'open'
    }, { signal: options.signal, timeout }, lifetime.signal)
    return session
  } catch (error) {
    await close()
    throw error
  }
}
module.exports = { openSession }
