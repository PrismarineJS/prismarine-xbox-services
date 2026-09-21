/* eslint-env mocha */
const test = it
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const wsModule = require('ws')
const { XboxRTA } = require('../')
const tick = () => new Promise(resolve => setImmediate(resolve))

async function withSocket (run) {
  const Original = wsModule.WebSocket
  const originalFetch = global.fetch
  const sockets = []
  class FakeSocket extends EventEmitter {
    static OPEN = 1
    constructor () { super(); this.readyState = 0; this.terminated = 0; sockets.push(this) }
    send () {}
    open () { this.readyState = 1; this.onopen?.() }
    serverClose (code) { this.readyState = 3; this.onclose?.({ code, reason: 'server close' }) }
    terminate () { this.terminated++; this.readyState = 3 }
  }
  wsModule.WebSocket = FakeSocket
  global.fetch = async () => ({ ok: true, json: async () => ({ nonce: 'nonce' }) })
  const rta = new XboxRTA({ getXboxToken: async () => ({ userHash: 'hash', XSTSToken: 'token' }) })
  try { await run(rta, sockets) } finally { await rta.destroy(); wsModule.WebSocket = Original; global.fetch = originalFetch }
}

test('connect waits for open and removes the startup deadline after success', async () => {
  await withSocket(async (rta, sockets) => {
    let connected = false
    const controller = new AbortController()
    const connecting = rta.connect({ timeout: 30, signal: controller.signal }).then(() => { connected = true })
    await tick()
    assert.equal(connected, false)
    sockets[0].open()
    await connecting
    assert.equal(connected, true)
    assert.equal(rta.startup, null)
    controller.abort()
    await new Promise(resolve => setTimeout(resolve, 40))
    assert.equal(sockets[0].terminated, 0)
  })
})

for (const action of ['timeout', 'abort', 'destroy', 'error', 'close']) {
  test(`rejects and releases a pending handshake on ${action}`, async () => {
    await withSocket(async (rta, sockets) => {
      const controller = new AbortController()
      const connecting = assert.rejects(rta.connect({ timeout: 20, signal: controller.signal }))
      await tick()
      assert.equal(sockets.length, 1)
      const socket = sockets[0]
      if (action === 'abort') controller.abort(new Error('caller cancelled'))
      if (action === 'destroy') await rta.destroy()
      if (action === 'error') socket.onerror({ error: new Error('handshake failed') })
      if (action === 'close') socket.serverClose(1000)
      await connecting
      assert.equal(socket.terminated, 1)
      assert.equal(rta.ws, null)
      assert.equal(rta.startup, null)
      assert.equal(rta.heartbeatTimeout, null)
      assert.equal(rta.reconnectTimeout, null)
    })
  })
}

test('normal server close clears timers and pending requests and permits reconnect', async () => {
  await withSocket(async (rta, sockets) => {
    const first = rta.connect()
    await tick()
    sockets[0].open()
    await first
    rta.heartbeat()
    const pending = assert.rejects(rta.subscribe('test'), /closed/)
    sockets[0].serverClose(1000)
    await pending
    assert.equal(rta.ws, null)
    assert.equal(rta.heartbeatTimeout, null)
    assert.equal(rta.reconnectTimeout, null)
    const second = rta.connect()
    await tick()
    sockets[1].open()
    await second
    assert.equal(rta.ws, sockets[1])
    await rta.destroy()
    await assert.rejects(rta.connect(), /closed/)
  })
})

test('an older aborted startup cannot release its replacement socket', async () => {
  await withSocket(async (rta, sockets) => {
    const first = assert.rejects(rta.connect(), /closed/)
    await tick()
    const replacement = rta.destroy(true)
    await tick()
    sockets[1].open()
    await Promise.all([first, replacement])
    assert.equal(sockets[0].terminated, 1)
    assert.equal(sockets[1].terminated, 0)
    assert.equal(rta.ws, sockets[1])
  })
})
