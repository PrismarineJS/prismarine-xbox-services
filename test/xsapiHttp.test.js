/* eslint-env mocha */
const assert = require('assert')
const { createXboxClient } = require('../')
const title = { titleId: '123', scid: 'test-scid', templateName: 'TestLobby' }
const tick = () => new Promise(resolve => setImmediate(resolve))

describe('Xbox HTTP requests', () => {
  let originalFetch
  const auth = { getXboxToken: async () => ({ userHash: 'hash', XSTSToken: 'test-token' }) }
  beforeEach(() => { originalFetch = global.fetch })
  afterEach(() => { global.fetch = originalFetch })

  it('accepts empty successful responses, including 204', async () => {
    for (const status of [200, 204]) {
      global.fetch = async () => new Response(null, { status })
      assert.strictEqual(await createXboxClient(auth).request('GET', 'https://example.com'), undefined)
    }
  })

  it('sets JSON headers and preserves IDs and falsy request bodies', async () => {
    global.fetch = async (url, request) => {
      assert.strictEqual(request.headers['content-type'], 'application/json')
      assert.strictEqual(request.headers.accept, 'application/json')
      assert.strictEqual(request.headers['x-xbl-contract-version'], '107')
      assert.strictEqual(request.body, 'false')
      return new Response('{"id":18446744073709551615}')
    }
    const response = await createXboxClient(auth).request('POST', 'https://example.com', { data: false, contractVersion: '107' })
    assert.strictEqual(response.id, '18446744073709551615')
  })

  it('surfaces unsuccessful HTTP status and malformed JSON', async () => {
    global.fetch = async () => new Response('unavailable', { status: 503 })
    await assert.rejects(createXboxClient(auth).request('GET', 'https://example.com'), /503.*unavailable/)
    global.fetch = async () => new Response('{')
    await assert.rejects(createXboxClient(auth).request('GET', 'https://example.com'))
  })

  it('bounds pending authentication and never fetches after a timeout', async () => {
    let resolveToken
    let fetched = false
    global.fetch = async () => { fetched = true }
    const pendingAuth = { getXboxToken: () => new Promise(resolve => { resolveToken = resolve }) }
    const rest = createXboxClient(pendingAuth, { timeout: 10 })
    await assert.rejects(rest.request('GET', 'https://example.com'), /timed out/)
    resolveToken(await auth.getXboxToken())
    await tick()
    assert.strictEqual(fetched, false)
  })

  it('bounds response-body reading and aborts the fetch signal', async () => {
    let signal
    global.fetch = async (url, request) => {
      signal = request.signal
      return { ok: true, text: () => new Promise(() => {}) }
    }
    await assert.rejects(createXboxClient(auth, { timeout: 10 }).request('GET', 'https://example.com'), /timed out/)
    assert.strictEqual(signal.aborted, true)
  })

  it('cancels active requests without preventing subsequent session cleanup requests', async () => {
    global.fetch = () => new Promise(() => {})
    const rest = createXboxClient(auth, title)
    const request = assert.rejects(rest.request('GET', 'https://example.com'), /cancelled/)
    rest.abortPending()
    await request
    global.fetch = async () => new Response(null, { status: 204 })
    await rest.updateSession('world', { members: { me: null } })
  })

  it('honors caller cancellation before and during a request', async () => {
    for (const beforehand of [true, false]) {
      const controller = new AbortController()
      global.fetch = () => new Promise(() => {})
      if (beforehand) controller.abort(new Error('caller cancelled'))
      const request = assert.rejects(createXboxClient(auth).request('GET', 'https://example.com', { signal: controller.signal }), /caller cancelled/)
      if (!beforehand) controller.abort(new Error('caller cancelled'))
      await request
    }
  })
  it('normalizes profile settings and distinguishes numeric gamertags from XUIDs', async () => {
    const urls = []
    global.fetch = async url => {
      urls.push(url)
      return new Response('{"profileUsers":[{"id":18446744073709551615,"settings":[{"id":"Gamertag","value":"123"},{"id":"GameDisplayName","value":"Display"},{"id":"GameDisplayPicRaw","value":"https://example.com/avatar"}]}]}')
    }
    const client = createXboxClient(auth)
    const profile = await client.getProfile({ gamertag: '123' })
    assert.deepStrictEqual(profile, { xuid: '18446744073709551615', gamertag: '123', displayName: 'Display', avatarUrl: 'https://example.com/avatar' })
    await client.getProfile({ xuid: '123' })
    assert(urls[0].includes('/gt(123)/'))
    assert(urls[1].includes('/xuids(123)/'))
    await assert.rejects(client.getProfile('123'), /Expected/)
    global.fetch = async () => new Response('{"profileUsers":[{"id":"123"}]}')
    assert.strictEqual((await client.getProfile()).gamertag, undefined)
  })

  it('queries activity handles with SCID alone', async () => {
    global.fetch = async (url, options) => {
      assert.strictEqual(JSON.parse(options.body).scid, 'example')
      return new Response('{"results":[]}')
    }
    assert.deepStrictEqual(await createXboxClient(auth, { scid: 'example' }).getActivityHandles('123'), [])
  })
})
