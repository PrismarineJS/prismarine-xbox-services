/* eslint-env mocha */
const assert = require('node:assert/strict')
const { EventEmitter, once } = require('node:events')
const rtaService = require('../src/rta')
const { createXboxClient } = require('..')
const auth = { getXboxToken: async () => ({ userHash: 'hash', XSTSToken: 'token' }) }
const title = { titleId: '123', scid: 'test', templateName: 'Lobby', timeout: 500 }
const tick = () => new Promise(resolve => setImmediate(resolve))
const member = xuid => ({ constants: { system: { xuid } }, properties: {} })

describe('managed session snapshots and lifecycle', () => {
  let originalFetch, originalConnect, requests, document, subscription, rta, sessions
  beforeEach(() => {
    originalFetch = global.fetch
    originalConnect = rtaService.connectRta
    requests = []
    sessions = []
    document = { members: { 0: member('123') }, properties: { custom: { world: 'test' } } }
    rtaService.connectRta = async () => {
      rta = new EventEmitter()
      subscription = new EventEmitter()
      subscription.data = { ConnectionId: 'connection' }
      rta.subscribe = async () => subscription
      rta.close = async () => { rta.closed = true }
      return rta
    }
    global.fetch = async (url, options) => {
      const body = options.body && JSON.parse(options.body)
      requests.push({ url, ...options, body })
      if (url.includes('profile.')) return new Response('{"profileUsers":[{"id":"123","settings":[{"id":"Gamertag","value":"Example"}]}]}')
      if (options.method === 'GET') return Response.json(document)
      return new Response(null, { status: 204 })
    }
  })
  afterEach(async () => {
    global.fetch = async () => new Response(null, { status: 204 })
    await Promise.all(sessions.map(session => session.close()))
    global.fetch = originalFetch
    rtaService.connectRta = originalConnect
  })
  async function create (options, defaults = title) {
    const session = await createXboxClient(auth, defaults).createSession(options)
    sessions.push(session)
    return session
  }

  it('supports caller names, normalized owner profiles, and optional activity publication', async () => {
    const session = await create({ name: 'named/world', properties: ({ profile }) => ({ custom: { owner: profile.xuid } }) })
    assert.equal(session.name, 'named/world')
    const write = requests.find(r => r.method === 'PUT')
    assert(write.url.endsWith('named%2Fworld'))
    assert.equal(write.body.properties.custom.owner, '123')
    assert(!requests.some(r => r.body?.type === 'activity'))
    assert.equal(session.snapshot.properties.custom.world, 'test')
    await session.setActivity()
    assert.equal(requests.at(-1).body.type, 'activity')
  })

  it('refreshes on notification and emits snapshot/member/property changes without duplicate events', async () => {
    const session = await create()
    const joined = once(session, 'memberJoin')
    const properties = once(session, 'propertiesChanged')
    const changed = once(session, 'changed')
    document = { members: { 0: member('123'), 1: member('456') }, properties: { custom: { world: 'new' } } }
    subscription.emit('data', { shoulderTap: true })
    assert.equal((await joined)[0].constants.system.xuid, '456')
    assert.equal((await properties)[0].custom.world, 'new')
    const [next, previous] = await changed
    assert.equal(previous.properties.custom.world, 'test')
    assert.equal(next.properties.custom.world, 'new')
    next.properties.custom.world = 'mutated'
    assert.equal(session.snapshot.properties.custom.world, 'new')
    let duplicates = 0
    session.on('changed', () => { duplicates++ })
    await session.get()
    await tick()
    assert.equal(duplicates, 0)
    const left = once(session, 'memberLeave')
    delete document.members[1]
    rta.emit('resync')
    assert.equal((await left)[0].constants.system.xuid, '456')
  })

  it('coalesces notification bursts and fetches again for changes arriving during a read', async () => {
    const session = await create()
    const fetch = global.fetch
    let finish
    let reads = 0
    let started
    const reading = new Promise(resolve => { started = resolve })
    global.fetch = async (url, options) => {
      if (options.method !== 'GET') return fetch(url, options)
      reads++
      if (reads === 1) await new Promise(resolve => { finish = resolve; started() })
      return Response.json(document)
    }
    subscription.emit('data', {})
    await reading
    for (let i = 0; i < 10; i++) subscription.emit('data', {})
    finish()
    await session.get()
    assert.equal(reads, 3) // first notification, one follow-up, explicit get
  })

  it('republishes on reconnect only after publication was requested', async () => {
    for (const publishActivity of [false, true]) {
      const session = await create({ publishActivity })
      requests.length = 0
      subscription.emit('ready', { ConnectionId: 'replacement' })
      await tick()
      await session.get()
      assert.equal(requests.filter(r => r.body?.type === 'activity').length, publishActivity ? 1 : 0)
      assert.equal(requests.find(r => r.method === 'PUT').body.members.me.properties.system.connection, 'replacement')
    }
  })

  it('wraps property updates, avoids profile lookups for explicit XUIDs, and closes once', async () => {
    const session = await create()
    await session.updateProperties({ custom: { members: 'opaque' } })
    assert.deepEqual(requests.filter(r => r.method === 'PUT').at(-1).body, { properties: { custom: { members: 'opaque' } } })
    const count = requests.length
    await session.invite({ xuid: '456' })
    assert.equal(requests.length, count + 1)
    const closing = session.close()
    assert.equal(session.close(), closing)
    await closing
    assert.equal(requests.filter(r => r.body?.members?.me === null).length, 1)
    await assert.rejects(session.get(), /not open/)
  })

  it('isolates session closure from shared client requests and other sessions', async () => {
    const first = await create()
    const second = await create()
    const fetch = global.fetch
    global.fetch = (url, options) => options.method === 'GET' ? new Promise(() => {}) : fetch(url, options)
    const pending = assert.rejects(first.get(), /closed/)
    await first.close()
    await pending
    global.fetch = fetch
    assert.equal((await second.get()).properties.custom.world, 'test')
  })

  it('bounds all startup steps and prevents a late property callback from writing membership', async () => {
    let finish
    await assert.rejects(createXboxClient(auth, title).createSession({ timeout: 20, properties: () => new Promise(resolve => { finish = resolve }) }), /timed out/)
    finish({})
    await tick()
    assert(!requests.some(r => r.method === 'PUT'))
    assert.equal(rta.closed, true)
  })

  it('uses a fresh bounded cleanup request after cancellation during membership', async () => {
    const controller = new AbortController()
    const fetch = global.fetch
    global.fetch = (url, options) => {
      if (JSON.parse(options.body || 'null')?.members?.me) {
        controller.abort(new Error('cancelled'))
        return new Promise(() => {})
      }
      return fetch(url, options)
    }
    await assert.rejects(createXboxClient(auth, title).createSession({ signal: controller.signal }), /cancelled/)
    assert.equal(requests.find(r => r.body?.members?.me === null).signal.aborted, false)
  })

  it('closes on background refresh failure but keeps explicit failures on their promises', async () => {
    const session = await create()
    const fetch = global.fetch
    global.fetch = async (url, options) => options.method === 'GET' ? new Response('failed', { status: 503 }) : fetch(url, options)
    await assert.rejects(session.get(), /503/)
    assert.equal(session.state, 'open')
    const error = once(session, 'error')
    subscription.emit('data', {})
    assert.match((await error)[0].message, /503/)
    assert.equal(session.state, 'closed')
  })
})
