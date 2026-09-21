/* eslint-env mocha */
const test = it
const assert = require('node:assert/strict')
const { XboxRTA } = require('../')
const tick = () => new Promise(resolve => setImmediate(resolve))
function ready () {
  const rta = new XboxRTA({})
  rta.ws = { readyState: 1, send () {}, on () {}, terminate () {} }
  return rta
}

test('isolates matching sequence IDs between instances and removes completed requests', async () => {
  const first = ready()
  const second = ready()
  const a = first.subscribe('first')
  const b = second.subscribe('second')
  second.onMessage('[1,0,0,20,{"ConnectionId":"second"}]')
  first.onMessage('[1,0,0,10,{"ConnectionId":"first"}]')
  assert.equal((await a).data.ConnectionId, 'first')
  assert.equal((await b).data.ConnectionId, 'second')
  assert.equal(first.promiseMap.size, 0)
  assert.equal(second.promiseMap.size, 0)
  await first.destroy()
  await second.destroy()
})

test('registers pending responses before sending', async () => {
  const rta = ready()
  rta.ws.send = () => rta.onMessage('[1,0,0,10,{}]')
  await rta.subscribe('test')
  await rta.destroy()
})

test('destroy rejects pending subscriptions and empties queued work', async () => {
  const rta = new XboxRTA({})
  const pending = assert.rejects(rta.subscribe('test'), /closed/)
  await rta.destroy()
  await pending
  assert.equal(rta.promiseMap.size, 0)
  assert.deepEqual(rta.queue, [])
})

test('deadline and destruction stop waiting for auth and prevent late fetches', async () => {
  const originalFetch = global.fetch
  try {
    for (const cancel of [false, true]) {
      let resolveToken
      let fetched = false
      global.fetch = async () => { fetched = true; throw new Error('late request') }
      const rta = new XboxRTA({ getXboxToken: () => new Promise(resolve => { resolveToken = resolve }) })
      const connecting = assert.rejects(rta.connect({ timeout: 10 }), cancel ? /closed/ : /timed out/)
      if (cancel) await rta.destroy()
      await connecting
      resolveToken({ userHash: 'hash', XSTSToken: 'token' })
      await tick()
      assert.equal(fetched, false)
      assert.equal(rta.ws, null)
      await rta.destroy()
    }
  } finally { global.fetch = originalFetch }
})

test('deadline aborts nonce fetch and bounds body reading', async () => {
  const originalFetch = global.fetch
  try {
    let signal
    global.fetch = async (url, options) => {
      signal = options.signal
      return { ok: true, json: () => new Promise(() => {}) }
    }
    const rta = new XboxRTA({ getXboxToken: async () => ({ userHash: 'hash', XSTSToken: 'token' }) })
    await assert.rejects(rta.connect({ timeout: 10 }), /timed out/)
    assert.equal(signal.aborted, true)
    assert.equal(rta.ws, null)
    await rta.destroy()
  } finally { global.fetch = originalFetch }
})

test('forwards transport errors and reports malformed responses', () => {
  const rta = ready()
  const errors = []
  rta.on('error', error => errors.push(error))
  rta.onError(new Error('socket failed'))
  assert.doesNotThrow(() => rta.onMessage('{'))
  assert.equal(errors.length, 2)
})

test('honors caller abort before authentication', async () => {
  const controller = new AbortController()
  controller.abort(new Error('caller cancelled'))
  const rta = new XboxRTA({ getXboxToken () { assert.fail('must not authenticate') } })
  await assert.rejects(rta.connect({ signal: controller.signal }), /caller cancelled/)
  await rta.destroy()
})

test('terminates a connecting socket without waiting for close', async () => {
  const rta = new XboxRTA({})
  let terminated = 0
  rta.ws = { readyState: 0, on () {}, terminate () { terminated++ } }
  await rta.destroy()
  await rta.destroy()
  assert.equal(terminated, 1)
  assert.equal(rta.ws, null)
})

test('serializes subscription URIs and removes the acknowledged subscription by its ID', async () => {
  const rta = ready()
  const sent = []
  rta.ws.send = message => sent.push(JSON.parse(message))
  const pending = rta.subscribe('https://example.com/"quoted"')
  assert.equal(sent[0][2], 'https://example.com/"quoted"')
  rta.onMessage('[1,0,0,42,{}]')
  await pending
  const unsubscribing = rta.unsubscribe(42)
  assert.deepEqual(sent[1], [2, 1, 42])
  rta.onMessage('[2,1,0]')
  await unsubscribing
  assert.equal(rta.subscriptions.size, 0)
  await rta.destroy()
})

test('ignores late subscription responses and never restores subscriptions after destroy', async () => {
  const rta = ready()
  rta.onMessage('[1,99,0,42,{}]')
  assert.equal(rta.subscriptions.size, 0)
  rta.once('subscribe', () => { rta.destroy() })
  const pending = rta.subscribe('test')
  rta.onMessage('[1,0,0,42,{}]')
  await pending
  assert.equal(rta.subscriptions.size, 0)
})

test('reports malformed message shapes and forwards resync notifications', async () => {
  const rta = ready()
  const errors = []
  rta.on('error', error => errors.push(error))
  for (const message of ['null', '{}']) assert.doesNotThrow(() => rta.onMessage(message))
  assert.equal(errors.length, 2)
  let resynced = false
  rta.on('resync', () => { resynced = true })
  rta.onMessage('[4]')
  assert.equal(resynced, true)
  await rta.destroy()
})
