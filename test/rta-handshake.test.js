/* eslint-env mocha */
const test = it
const assert = require('node:assert/strict')
const { getEventListeners } = require('node:events')
const { XboxRTASocket, SocketClosedError, SocketAlreadyConnectedError } = require('../')
const tick = () => new Promise(resolve => setImmediate(resolve))

async function withSocket (run) {
  const Original = global.WebSocket
  const originalFetch = global.fetch
  const sockets = []
  class FakeSocket extends EventTarget {
    static OPEN = 1
    constructor () { super(); this.readyState = 0; this.closeCalls = 0; sockets.push(this) }
    send () {}
    open () { this.readyState = 1; this.dispatchEvent(new Event('open')) }
    serverClose (code) { this.readyState = 3; this.dispatchEvent(new CloseEvent('close', { code, reason: 'server close' })) }
    close () { this.closeCalls++; this.readyState = 3 }
  }
  global.WebSocket = FakeSocket
  global.fetch = async () => ({ ok: true, json: async () => ({ nonce: 'nonce' }) })
  const rta = new XboxRTASocket({ getXboxToken: async () => ({ userHash: 'hash', XSTSToken: 'token' }) })
  try { await run(rta, sockets) } finally { await rta.close(); global.WebSocket = Original; global.fetch = originalFetch }
}

test('init waits for open and removes the startup deadline after success', async () => {
  await withSocket(async (rta, sockets) => {
    let connected = false
    const controller = new AbortController()
    const connecting = rta.init({ timeout: 30, signal: controller.signal }).then(() => { connected = true })
    await tick()
    assert.equal(connected, false)
    await assert.rejects(rta.init(), SocketAlreadyConnectedError)
    sockets[0].open()
    await connecting
    assert.equal(connected, true)
    await assert.rejects(rta.init(), SocketAlreadyConnectedError)
    assert.equal(rta._initController, null)
    controller.abort()
    await new Promise(resolve => setTimeout(resolve, 40))
    assert.equal(sockets[0].closeCalls, 0)
  })
})

for (const action of ['timeout', 'abort', 'destroy', 'error', 'close']) {
  test(`rejects and releases a pending handshake on ${action}`, async () => {
    await withSocket(async (rta, sockets) => {
      const controller = new AbortController()
      const connecting = assert.rejects(rta.init({ timeout: 20, signal: controller.signal }))
      await tick()
      assert.equal(sockets.length, 1)
      const socket = sockets[0]
      if (action === 'abort') controller.abort(new Error('caller cancelled'))
      if (action === 'destroy') await rta.close()
      if (action === 'error') socket.dispatchEvent(Object.assign(new Event('error'), { error: new Error('handshake failed') }))
      if (action === 'close') socket.serverClose(1000)
      await connecting
      assert.equal(socket.closeCalls, 1)
      assert.equal(rta.ws, null)
      assert.equal(rta._initController, null)
      assert.equal(rta.reconnectTimeout, null)
    })
  })
}

test('normal server close clears timers and pending requests and permits reconnect', async () => {
  await withSocket(async (rta, sockets) => {
    const first = rta.init()
    await tick()
    sockets[0].open()
    await first
    const pending = assert.rejects(rta.subscribe('test'), SocketClosedError)
    sockets[0].serverClose(1000)
    await pending
    assert.equal(rta.ws, null)
    assert.equal(rta.reconnectTimeout, null)
    const second = rta.init()
    await tick()
    sockets[1].open()
    await second
    assert.equal(rta.ws, sockets[1])
    await rta.close()
    await assert.rejects(rta.init(), SocketClosedError)
  })
})

test('an older aborted startup cannot release its replacement socket', async () => {
  await withSocket(async (rta, sockets) => {
    const first = assert.rejects(rta.init(), /reconnecting/)
    await tick()
    const replacement = rta.reconnect()
    await tick()
    sockets[1].open()
    await Promise.all([first, replacement])
    assert.equal(sockets[0].closeCalls, 1)
    assert.equal(sockets[1].closeCalls, 0)
    assert.equal(rta.ws, sockets[1])
    for (const event of ['error', 'close', 'message']) {
      assert.equal(getEventListeners(sockets[0], event).length, 0)
      assert.equal(getEventListeners(sockets[1], event).length, 1)
    }
    let resyncs = 0
    rta.on('resync', () => { resyncs++ })
    sockets[0].dispatchEvent(Object.assign(new Event('message'), { data: '[4]' }))
    sockets[0].serverClose(1006)
    assert.equal(resyncs, 0)
    assert.equal(rta.ws, sockets[1])
    await rta.close()
    for (const event of ['error', 'close', 'message']) {
      assert.equal(getEventListeners(sockets[1], event).length, 0)
    }
  })
})
