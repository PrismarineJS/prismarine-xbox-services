/* eslint-env mocha */
const assert = require('assert/strict')
const { once } = require('events')
const { createServer } = require('http')
const { WebSocketServer } = require('ws')
const { XboxRTASocket, XboxRTASubscription, SocketClosedError, RTARequestError, ServiceError } = require('..')
const tick = () => new Promise(resolve => setImmediate(resolve))
const auth = { getXboxToken: async () => ({ userHash: 'hash', XSTSToken: 'token' }) }

async function withServer (run) {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await once(server, 'listening')
  const Original = global.WebSocket
  const originalFetch = global.fetch
  global.WebSocket = class extends Original {
    constructor (url, protocol) {
      assert.equal(new URL(url).hostname, 'rta.xboxlive.com')
      assert.equal(protocol, 'rta.xboxlive.com.V2')
      super(`ws://127.0.0.1:${server.address().port}`, protocol)
    }
  }
  global.fetch = async () => new Response('{"nonce":"local"}')
  const rta = new XboxRTASocket(auth)
  try { await run(rta, server) } finally {
    await rta.close()
    for (const socket of server.clients) socket.terminate()
    await new Promise(resolve => server.close(resolve))
    global.WebSocket = Original
    global.fetch = originalFetch
  }
}

it('restores native WebSocket subscriptions before reconnect resolves', async () => {
  await withServer(async (rta, server) => {
    const connections = []
    let acknowledge
    server.on('connection', socket => {
      connections.push(socket)
      const id = 41 + connections.length
      socket.on('message', raw => {
        const [type, sequenceId, payload] = JSON.parse(raw)
        if (type === 1) {
          const reply = () => socket.send(JSON.stringify([1, sequenceId, 0, id, { ConnectionId: `local-${id}` }]))
          if (id === 42) reply()
          else acknowledge = reply
        } else {
          assert.equal(payload, id)
          socket.send(JSON.stringify([2, sequenceId, 0]))
        }
      })
    })
    await rta.init()
    const subscription = await rta.subscribe('https://sessiondirectory.xboxlive.com/connections/')
    assert(subscription instanceof XboxRTASubscription)
    assert.equal(subscription.initialData.ConnectionId, 'local-42')
    const event = once(subscription, 'data')
    connections[0].send('[3,42,{"changed":true}]')
    assert.equal((await event)[0].changed, true)
    assert.equal(subscription.initialData.ConnectionId, 'local-42')
    const secondConnection = once(server, 'connection')
    let restored = false
    const reconnecting = rta.reconnect().then(() => { restored = true })
    const [peer] = await secondConnection
    await once(peer, 'message')
    assert.equal(restored, false)
    acknowledge()
    await reconnecting
    assert.equal(subscription.initialData.ConnectionId, 'local-43')
    const nextEvent = once(subscription, 'data')
    peer.send('[3,43,{"changed":"after reconnect"}]')
    assert.equal((await nextEvent)[0].changed, 'after reconnect')
    await subscription.close()
    assert.equal(rta._subscriptions.size, 0)
  })
})

it('automatically answers server pings and releases local work when the peer stalls', async () => {
  await withServer(async (rta, server) => {
    const connected = once(server, 'connection')
    await rta.init()
    const [peer] = await connected
    const pong = once(peer, 'pong')
    peer.ping('probe')
    assert.equal((await pong)[0].toString(), 'probe')
    const pending = assert.rejects(rta.subscribe('unanswered'), SocketClosedError)
    await once(peer, 'message')
    peer.pause() // Stop reading, including the client's close handshake.
    const socket = rta.ws
    await rta.close()
    await pending
    assert.equal(rta.ws, null)
    assert.equal(rta._pendingRequests.size, 0)
    assert.equal(socket.readyState, global.WebSocket.CLOSING)
    peer.terminate() // Native WebSocket has no public force-close operation.
    await once(socket, 'close')
  })
})

for (const failure of ['timeout', 'status']) {
  it(`rejects reconnect on restoration ${failure} without a duplicate error event`, async () => {
    await withServer(async (rta, server) => {
      let connections = 0
      let errors = 0
      rta.on('error', () => { errors++ })
      server.on('connection', socket => {
        const initial = ++connections === 1
        socket.on('message', raw => {
          const [, sequenceId] = JSON.parse(raw)
          if (initial) socket.send(JSON.stringify([1, sequenceId, 0, 42, {}]))
          else if (failure === 'status') socket.send(JSON.stringify([1, sequenceId, 1001]))
        })
      })
      await rta.init({ timeout: 100 })
      await rta.subscribe('test')
      await assert.rejects(rta.reconnect(), failure === 'status' ? RTARequestError : /timed out/)
      assert.equal(rta.ws, null)
      assert.equal(rta._initController, null)
      assert.equal(rta.reconnectTimeout, null)
      assert.equal(errors, 0)
    })
  })
}

it('aborts a native WebSocket while its HTTP upgrade is pending', async () => {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const Original = global.WebSocket
  const originalFetch = global.fetch
  let peer
  server.on('upgrade', (request, socket) => { peer = socket })
  global.WebSocket = class extends Original {
    constructor () { super(`ws://127.0.0.1:${server.address().port}`) }
  }
  global.fetch = async () => new Response('{"nonce":"local"}')
  const rta = new XboxRTASocket(auth)
  try {
    const controller = new AbortController()
    const upgraded = once(server, 'upgrade')
    const connecting = assert.rejects(rta.init({ signal: controller.signal }), /cancel startup/)
    await upgraded
    const socket = rta.ws
    const closed = once(socket, 'close')
    controller.abort(new Error('cancel startup'))
    await connecting
    assert.equal((await closed)[0].code, 1006)
    assert.equal(rta.ws, null)
  } finally {
    await rta.close()
    peer?.destroy()
    await new Promise(resolve => server.close(resolve))
    global.WebSocket = Original
    global.fetch = originalFetch
  }
})

it('reports nonce HTTP failures with structured service errors', async () => {
  const originalFetch = global.fetch
  global.fetch = async () => new Response('unavailable', { status: 503 })
  const rta = new XboxRTASocket(auth)
  try {
    await assert.rejects(rta.init(), error => {
      assert(error instanceof ServiceError)
      assert.equal(error.service, 'Xbox RTA')
      assert.equal(error.status, 503)
      assert.equal(error.body, 'unavailable')
      return true
    })
    await tick()
    assert.equal(rta.ws, null)
  } finally {
    await rta.close()
    global.fetch = originalFetch
  }
})

it('distinguishes remote disconnection from idempotent terminal closure', async () => {
  await withServer(async (rta, server) => {
    let closes = 0
    rta.on('close', () => { closes++ })
    const connected = once(server, 'connection')
    await rta.init()
    const [peer] = await connected
    const disconnected = once(rta, 'disconnect')
    peer.close(1000, 'server restart')
    assert.deepEqual(await disconnected, [1000, 'server restart'])
    assert.equal(closes, 0)
    assert.equal(rta.closed, false)
    await rta.init()
    await rta.close()
    await rta.close()
    assert.equal(closes, 1)
    assert.equal(rta.closed, true)
  })
})
