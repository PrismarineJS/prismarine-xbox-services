/* eslint-env mocha */
const assert = require('assert/strict')
const { EventEmitter } = require('events')
const { XboxClient, XboxSession, XboxRTASocket } = require('..')
const title = { titleId: '123', scid: 'example', templateName: 'Lobby', timeout: 500 }
const auth = { getXboxToken: async () => ({ userHash: 'hash', XSTSToken: 'token' }) }
const tick = () => new Promise(resolve => setImmediate(resolve))
function deferred () {
  let complete
  const promise = new Promise(resolve => { complete = resolve })
  return { promise, resolve: complete }
}

describe('managed sessions', () => {
  let originalFetch, init, subscribe, requests, subscription, rta, document
  beforeEach(() => {
    originalFetch = global.fetch
    init = XboxRTASocket.prototype.init
    subscribe = XboxRTASocket.prototype.subscribe
    requests = []
    document = { properties: { custom: { game: 'example' } } }
    subscription = new EventEmitter()
    subscription.initialData = { ConnectionId: 'connection' }
    XboxRTASocket.prototype.init = async function () { rta = this }
    XboxRTASocket.prototype.subscribe = async () => subscription
    global.fetch = async (url, options) => {
      const body = options.body && JSON.parse(options.body)
      requests.push({ url, ...options, body })
      if (url.includes('profile.')) return new Response('{"profileUsers":[{"id":"12345"}]}')
      if (options.method === 'GET') return new Response(JSON.stringify(document))
      return new Response(null, { status: 204 })
    }
  })
  afterEach(() => {
    global.fetch = originalFetch
    XboxRTASocket.prototype.init = init
    XboxRTASocket.prototype.subscribe = subscribe
  })

  it('returns ready sessions with matching create/join APIs and no redundant property write', async () => {
    const client = new XboxClient(auth, title)
    for (const create of [true, false]) {
      requests.length = 0
      const session = create
        ? await client.createSession({ properties: ({ profile }) => ({ custom: { owner: profile.xuid } }) })
        : await client.joinSession('existing')
      assert(session instanceof XboxSession)
      assert.equal(session.state, 'open')
      const writes = requests.filter(request => request.method === 'PUT')
      assert.equal(writes.length, 1)
      assert.equal(writes[0].body.members.me.properties.system.connection, 'connection')
      assert.equal(writes[0].body.properties?.custom.owner, create ? '12345' : undefined)
      assert.equal((await session.get()).properties.custom.game, 'example')
      await session.close()
      assert.equal(session.state, 'closed')
    }
  })

  it('updates only properties, supports explicit gamertags, and leaves once', async () => {
    const session = await new XboxClient(auth, title).createSession()
    await session.updateProperties({ custom: { members: 'data' } })
    assert.deepEqual(requests.at(-1).body, { properties: { custom: { members: 'data' } } })
    await session.invite({ gamertag: '12345' })
    assert(requests.at(-2).url.includes('gt(12345)'))
    assert.equal(requests.at(-1).body.invitedXuid, '12345')
    const count = requests.length
    await session.invite({ xuid: '98765' })
    assert.equal(requests.length, count + 1)
    assert.equal(requests.at(-1).body.invitedXuid, '98765')
    const closing = session.close()
    assert.equal(session.close(), closing)
    await closing
    assert.equal(requests.filter(r => r.body?.members?.me === null).length, 1)
    await assert.rejects(session.get(), /not open/)
  })

  it('uses a caller name and only publishes activity when requested, including reconnects', async () => {
    const session = await new XboxClient(auth, title).createSession({ name: 'chosen/name' })
    assert.equal(session.name, 'chosen/name')
    assert(requests.some(request => request.url.endsWith('/sessions/chosen%2Fname')))
    const activities = () => requests.filter(request => request.body?.type === 'activity').length
    subscription.emit('ready', { ConnectionId: 'second' })
    await session._refresh
    assert.equal(activities(), 0)
    await session.setActivity()
    assert.equal(activities(), 1)
    subscription.emit('ready', { ConnectionId: 'third' })
    await session._refresh
    assert.equal(activities(), 2)
    await session.close()
  })

  it('refreshes snapshots on notifications and resync, comparing members by XUID', async () => {
    const member = xuid => ({ constants: { system: { xuid } } })
    document.members = { 0: member('123'), 1: member('456') }
    const session = await new XboxClient(auth, title).joinSession('existing')
    const changes = []; const joined = []; const left = []; const properties = []
    session.on('changed', (next, previous) => { changes.push([next, previous]); next.properties.custom.game = 'listener mutation' })
    session.on('memberJoin', member => joined.push(member.constants.system.xuid))
    session.on('memberLeave', member => left.push(member.constants.system.xuid))
    session.on('propertiesChanged', value => properties.push(value))
    session.current.properties.custom.game = 'caller mutation'
    assert.equal(session.current.properties.custom.game, 'example')
    document = { members: { 8: member('123'), 9: member('789') }, properties: { custom: { game: 'changed' } } }
    subscription.emit('data', { notification: 'opaque' })
    await session._refresh
    assert.equal(changes.length, 1)
    assert.deepEqual(joined, ['789'])
    assert.deepEqual(left, ['456'])
    assert.equal(properties[0].custom.game, 'changed')
    assert.equal(session.current.properties.custom.game, 'changed')
    rta.emit('resync')
    await session._refresh
    assert.equal(changes.length, 1)
    document.properties.custom.game = 'resynced'
    rta.emit('resync')
    await session._refresh
    assert.equal(changes.length, 2)
    await session.close()
    subscription.emit('data', {})
    await session._refresh
    assert.equal(changes.length, 2)
  })

  it('does not lose changes or a replacement connection during the initial snapshot read', async () => {
    const fetch = global.fetch
    let reads = 0
    global.fetch = async (url, options) => {
      const response = await fetch(url, options)
      if (url.includes('sessiondirectory.') && options.method === 'GET' && ++reads === 1) {
        document.properties.custom.game = 'during startup'
        subscription.emit('data', {})
        subscription.emit('ready', { ConnectionId: 'during-read' })
      }
      return response
    }
    const session = await new XboxClient(auth, title).joinSession('existing')
    assert.equal(session.current.properties.custom.game, 'during startup')
    assert.equal(reads, 2)
    assert(requests.some(request => request.body?.members?.me?.properties?.system?.connection === 'during-read'))
    await session.close()
  })

  it('serializes refreshes and retains notifications arriving during a read', async () => {
    const session = await new XboxClient(auth, title).joinSession('existing')
    const fetch = global.fetch
    const gate = deferred()
    let reads = 0
    global.fetch = async (url, options) => {
      const response = await fetch(url, options)
      if (options.method === 'GET' && ++reads === 1) await gate.promise
      return response
    }
    subscription.emit('data', {})
    await tick()
    document.properties.custom.game = 'latest'
    subscription.emit('data', {})
    await tick()
    assert.equal(reads, 1)
    gate.resolve()
    await session._refresh
    assert.equal(reads, 2)
    assert.equal(session.current.properties.custom.game, 'latest')
    await session.close()
  })

  it('ignores a snapshot response that finishes after session closure', async () => {
    const session = await new XboxClient(auth, title).joinSession('existing')
    const fetch = global.fetch
    const gate = deferred()
    let changes = 0
    session.on('changed', () => { changes++ })
    document.properties.custom.game = 'too late'
    global.fetch = async (url, options) => {
      const response = await fetch(url, options)
      if (options.method === 'GET') await gate.promise
      return response
    }
    subscription.emit('data', {})
    await tick()
    await session.close()
    gate.resolve()
    await session._refresh
    await tick()
    assert.equal(changes, 0)
    assert.equal(session.current.properties.custom.game, 'example')
  })

  it('does not require invitation title ID for session membership', async () => {
    const session = await new XboxClient(auth, { scid: 'example', templateName: 'Lobby' }).joinSession('existing')
    await assert.rejects(session.invite({ xuid: '123' }), /titleId/)
    await session.close()
  })

  it('rejects before any request when startup is already cancelled', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await assert.rejects(new XboxClient(auth, title).createSession({ signal: controller.signal }), /cancelled/)
    assert.equal(requests.length, 0)
  })

  it('uses a single startup deadline, including asynchronous properties', async () => {
    const properties = deferred()
    const creating = new XboxClient(auth, title).createSession({ timeout: 20, properties: () => properties.promise })
    await assert.rejects(creating, /timed out/)
    properties.resolve({})
    await tick()
    assert.equal(requests.filter(r => r.method === 'PUT').length, 0)
    assert.equal(rta.closed, true)
  })

  it('cancels after membership starts and uses a fresh signal for cleanup', async () => {
    const fetch = global.fetch
    const controller = new AbortController()
    global.fetch = async (url, options) => {
      const body = options.body && JSON.parse(options.body)
      if (body?.members?.me) {
        controller.abort(new Error('cancel startup'))
        return new Promise(() => {})
      }
      return fetch(url, options)
    }
    await assert.rejects(new XboxClient(auth, title).createSession({ signal: controller.signal }), /cancel startup/)
    const leave = requests.find(r => r.body?.members?.me === null)
    assert(leave)
    assert.equal(leave.signal.aborted, false)
  })

  it('isolates cancellation between sessions and the parent client', async () => {
    const client = new XboxClient(auth, title)
    const first = await client.createSession()
    const second = await client.createSession()
    const fetch = global.fetch
    global.fetch = async (url, options) => options.method === 'GET' ? new Promise(() => {}) : fetch(url, options)
    const pending = assert.rejects(first.get(), /closed/)
    await first.close()
    await pending
    global.fetch = fetch
    assert.equal((await second.get()).properties.custom.game, 'example')
    assert.equal((await client.getProfile()).xuid, '12345')
    await second.close()
  })

  it('serializes subscription refreshes and reports a terminal close once', async () => {
    const session = await new XboxClient(auth, title).joinSession('existing')
    subscription.emit('ready', { ConnectionId: 'replacement' })
    await tick()
    assert(requests.some(r => r.body?.members?.me?.properties?.system?.connection === 'replacement'))
    const failure = new Promise(resolve => session.once('error', resolve))
    rta.onSocketClose({ code: 1000, reason: 'shutdown' })
    assert.match((await failure).message, /shutdown/)
    assert.equal(session.state, 'closed')
  })

  it('does not emit a duplicate error for a rejected explicit operation', async () => {
    const session = await new XboxClient(auth, title).createSession()
    let errors = 0
    session.on('error', () => { errors++ })
    const fetch = global.fetch
    global.fetch = async () => new Response('failed', { status: 503 })
    await assert.rejects(session.get(), /503/)
    assert.equal(errors, 0)
    global.fetch = fetch
    await session.close()
  })
  it('allows a longer per-operation deadline and does not retain startup cancellation', async () => {
    const fetch = global.fetch
    global.fetch = async (url, options) => {
      if (url.includes('profile.')) await new Promise(resolve => setTimeout(resolve, 25))
      return fetch(url, options)
    }
    const controller = new AbortController()
    const session = await new XboxClient(auth, { ...title, timeout: 5 }).createSession({ timeout: 200, signal: controller.signal })
    controller.abort()
    global.fetch = fetch
    assert.equal((await session.get()).properties.custom.game, 'example')
    await session.close()
  })

  it('preserves a replacement connection received during startup', async () => {
    const session = await new XboxClient(auth, title).createSession({
      properties: () => {
        subscription.emit('ready', { ConnectionId: 'reconnected-during-start' })
        return {}
      }
    })
    const writes = requests.filter(r => r.body?.members?.me)
    assert.equal(writes.at(-1).body.members.me.properties.system.connection, 'reconnected-during-start')
    await session.close()
  })

  it('rejects startup RTA failures without an unhandled error event', async () => {
    XboxRTASocket.prototype.subscribe = async function () {
      this.emit('error', new Error('transport failed'))
      throw new Error('transport failed')
    }
    await assert.rejects(new XboxClient(auth, title).createSession(), /transport failed/)
    assert.equal(rta.closed, true)
  })

  it('bounds cleanup separately and preserves the original startup failure', async () => {
    global.fetch = async (url, options) => {
      if (url.includes('profile.')) return new Response('{"profileUsers":[{"id":"123"}]}')
      if (options.body === '{"members":{"me":null}}') return new Promise(() => {})
      return new Response('membership failed', { status: 503 })
    }
    await assert.rejects(new XboxClient(auth, { ...title, cleanupTimeout: 10 }).createSession(), /membership failed/)
    assert.equal(rta.closed, true)
  })
})
