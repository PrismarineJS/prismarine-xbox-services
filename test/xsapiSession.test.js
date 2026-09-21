/* eslint-env mocha */
const assert = require('assert/strict')
const { EventEmitter } = require('events')
const { XboxClient, XboxSession, XboxRTA } = require('..')
const title = { titleId: '123', scid: 'example', templateName: 'Lobby', timeout: 500 }
const auth = { getXboxToken: async () => ({ userHash: 'hash', XSTSToken: 'token' }) }
const tick = () => new Promise(resolve => setImmediate(resolve))
function deferred () {
  let complete
  const promise = new Promise(resolve => { complete = resolve })
  return { promise, resolve: complete }
}

describe('managed sessions', () => {
  let originalFetch, connect, subscribe, requests, subscription, rta
  beforeEach(() => {
    originalFetch = global.fetch
    connect = XboxRTA.prototype.connect
    subscribe = XboxRTA.prototype.subscribe
    requests = []
    subscription = new EventEmitter()
    subscription.data = { ConnectionId: 'connection' }
    XboxRTA.prototype.connect = async function () { rta = this }
    XboxRTA.prototype.subscribe = async () => subscription
    global.fetch = async (url, options) => {
      const body = options.body && JSON.parse(options.body)
      requests.push({ url, ...options, body })
      if (url.includes('profile.')) return new Response('{"profileUsers":[{"id":"12345"}]}')
      if (options.method === 'GET') return new Response('{"properties":{"custom":{"game":"example"}}}')
      return new Response(null, { status: 204 })
    }
  })
  afterEach(() => {
    global.fetch = originalFetch
    XboxRTA.prototype.connect = connect
    XboxRTA.prototype.subscribe = subscribe
  })

  it('returns ready sessions with matching create/join APIs and no redundant property write', async () => {
    const client = new XboxClient(auth, title)
    for (const create of [true, false]) {
      requests.length = 0
      const session = create
        ? await client.createSession({ properties: ({ profile }) => ({ custom: { owner: profile.id } }) })
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
    assert.equal((await client.getProfile()).id, '12345')
    await second.close()
  })

  it('serializes subscription refreshes and reports a terminal close once', async () => {
    const session = await new XboxClient(auth, title).joinSession('existing')
    subscription.emit('ready', { ConnectionId: 'replacement' })
    await tick()
    assert(requests.some(r => r.body?.members?.me?.properties?.system?.connection === 'replacement'))
    const failure = new Promise(resolve => session.once('error', resolve))
    rta.onClose(1000, 'shutdown')
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
    XboxRTA.prototype.subscribe = async function () {
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
