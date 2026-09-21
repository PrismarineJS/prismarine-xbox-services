/* eslint-env mocha */
const assert = require('assert/strict')
const { XboxRTASocket, SocketError, SocketClosedError, SocketNotConnectedError, RTARequestError } = require('..')
const tick = () => new Promise(resolve => setImmediate(resolve))
function ready () {
  const rta = new XboxRTASocket({})
  rta.ws = { readyState: 1, send () {}, close () {} }
  return rta
}

it('isolates matching sequence IDs between instances', async () => {
  const first = ready()
  const second = ready()
  const a = first.subscribe('first')
  const b = second.subscribe('second')
  await tick()
  second.onMessage('[1,0,0,20,{"ConnectionId":"second"}]')
  first.onMessage('[1,0,0,10,{"ConnectionId":"first"}]')
  assert.equal((await a).initialData.ConnectionId, 'first')
  assert.equal((await b).initialData.ConnectionId, 'second')
  await first.close()
  await second.close()
})

it('rejects requests made before connecting rather than silently queuing', async () => {
  const rta = new XboxRTASocket({})
  await assert.rejects(rta.subscribe('test'), SocketNotConnectedError)
  assert.equal(rta._subscriptions.size, 0)
  await rta.close()
  for (const call of [() => rta.connect(), () => rta.reconnect(), () => rta.subscribe('test')]) {
    await assert.rejects(call(), error => {
      assert(error instanceof SocketClosedError)
      assert(error instanceof SocketError)
      assert(error instanceof Error)
      assert.equal(error.name, 'SocketClosedError')
      assert.match(error.message, /closed/)
      return true
    })
  }
})

it('closes pending subscriptions and clears connection bookkeeping', async () => {
  const rta = ready()
  const pending = assert.rejects(rta.subscribe('test'), SocketClosedError)
  await tick()
  await rta.close()
  await pending
  assert.equal(rta._pendingRequests.size, 0)
  assert.equal(rta._subscriptions.size, 0)
})

it('keeps subscription identity across reconnect responses and routes data to it', async () => {
  const rta = ready()
  const sent = []
  rta.ws.send = raw => {
    const [type, sequenceId, payload] = JSON.parse(raw)
    sent.push([type, sequenceId, payload])
    rta.onMessage(JSON.stringify(type === 1 ? [1, sequenceId, 0, sequenceId + 40, { generation: sequenceId }] : [2, sequenceId, 0]))
  }
  const sub = await rta.subscribe('test/"quoted"')
  assert.equal(sent[0][2], 'test/"quoted"')
  let updated
  sub.on('ready', data => { updated = data })
  await rta._restoreSubscriptions()
  await tick()
  assert.equal(sub.initialData.generation, 1)
  assert.equal(updated.generation, 1)
  let data
  sub.on('data', value => { data = value })
  rta.onMessage('[3,41,{"changed":true}]')
  assert.equal(data.changed, true)
  await sub.close()
  assert.deepEqual(sent.at(-1), [2, 2, 41])
  assert.equal(rta._subscriptions.size, 0)
  await rta.close()
})

it('rejects subscription failures without also emitting an error', async () => {
  const rta = ready()
  rta.ws.send = () => rta.onMessage('[1,0,1001]')
  // No error listener is necessary for an awaited request rejection.
  await assert.rejects(rta.subscribe('test'), error => {
    assert(error instanceof RTARequestError)
    assert.equal(error.status, 1001)
    assert.equal(error.code, 'Throttled')
    return true
  })
  assert.equal(rta._subscriptions.size, 0)
  await rta.close()
})

it('cancels pending subscribe and unsubscribes a late successful response', async () => {
  const rta = ready()
  const sent = []
  rta.ws.send = raw => {
    const message = JSON.parse(raw)
    sent.push(message)
    if (message[0] === 2) rta.onMessage(JSON.stringify([2, message[1], 0]))
  }
  const controller = new AbortController()
  const pending = assert.rejects(rta.subscribe('test', { signal: controller.signal }), /cancelled/)
  await tick()
  controller.abort(new Error('cancelled'))
  await pending
  rta.onMessage('[1,0,0,42,{}]')
  await tick()
  assert.deepEqual(sent.at(-1), [2, 1, 42])
  assert.equal(rta._subscriptions.size, 0)
  await rta.close()
})

it('bounds authentication and prevents late requests without forcing token refresh', async () => {
  const originalFetch = global.fetch
  try {
    for (const cancel of [false, true]) {
      let resolveToken
      global.fetch = async () => assert.fail('late request')
      const rta = new XboxRTASocket({
        getXboxToken: (relyingParty, forceRefresh) => {
          assert.equal(forceRefresh, undefined)
          return new Promise(resolve => { resolveToken = resolve })
        }
      })
      const connecting = assert.rejects(rta.connect({ timeout: 10 }), cancel ? /closed/ : /timed out/)
      await tick()
      if (cancel) await rta.close()
      await connecting
      resolveToken({ userHash: 'hash', XSTSToken: 'token' })
      await tick()
      assert.equal(rta.ws, null)
      await rta.close()
    }
  } finally { global.fetch = originalFetch }
})

it('reports malformed message shapes and forwards resync notifications', async () => {
  const rta = ready()
  const errors = []
  rta.on('error', error => errors.push(error))
  for (const message of ['null', '{}', '{']) assert.doesNotThrow(() => rta.onMessage(message))
  assert.equal(errors.length, 3)
  let resynced = false
  rta.on('resync', () => { resynced = true })
  rta.onMessage('[4]')
  assert.equal(resynced, true)
  await rta.close()
})

it('closing during resubscribe prevents resurrection and cleans up a late wire response', async () => {
  const rta = ready()
  const sent = []
  rta.ws.send = raw => {
    const [type, sequence, payload] = JSON.parse(raw)
    sent.push([type, sequence, payload])
    if (type === 1 && sequence === 0) rta.onMessage('[1,0,0,42,{}]')
    if (type === 2) rta.onMessage(JSON.stringify([2, sequence, 0]))
  }
  const sub = await rta.subscribe('test')
  const restoring = rta._restoreSubscriptions()
  await tick()
  await sub.close()
  await restoring
  rta.onMessage('[1,1,0,43,{}]')
  await tick()
  await rta.close()
  assert.equal(sub.closed, true)
  assert.equal(rta._subscriptions.size, 0)
  assert.deepEqual(sent.at(-1), [2, 2, 43])
})
