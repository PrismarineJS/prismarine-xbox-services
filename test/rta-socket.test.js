/* eslint-env mocha */
const assert = require('assert/strict')
const { once } = require('events')
const wsModule = require('ws')
const { XboxRTASocket } = require('..')

it('preserves a subscription across real WebSocket reconnection and closes its current ID', async () => {
  const server = new wsModule.WebSocketServer({ port: 0, host: '127.0.0.1' })
  await once(server, 'listening')
  const Original = wsModule.WebSocket
  const originalFetch = global.fetch
  const connections = []
  server.on('connection', socket => {
    connections.push(socket)
    const id = 41 + connections.length
    socket.on('message', raw => {
      const [type, sequenceId, payload] = JSON.parse(raw)
      if (type === 1) socket.send(JSON.stringify([1, sequenceId, 0, id, { ConnectionId: `local-${id}` }]))
      else {
        assert.equal(payload, id)
        socket.send(JSON.stringify([2, sequenceId, 0]))
      }
    })
  })
  wsModule.WebSocket = class extends Original {
    constructor (url, protocol) {
      assert.equal(new URL(url).hostname, 'rta.xboxlive.com')
      super(`ws://127.0.0.1:${server.address().port}`, protocol)
    }
  }
  global.fetch = async () => new Response('{"nonce":"local"}')
  const rta = new XboxRTASocket({ getXboxToken: async () => ({ userHash: 'hash', XSTSToken: 'token' }) })
  try {
    await rta.connect()
    const subscription = await rta.subscribe('https://sessiondirectory.xboxlive.com/connections/')
    assert.equal(subscription.data.ConnectionId, 'local-42')
    const event = once(subscription, 'data')
    connections[0].send('[3,42,{"changed":true}]')
    assert.equal((await event)[0].changed, true)
    const restored = once(subscription, 'ready')
    await rta.reconnect()
    assert.equal((await restored)[0].ConnectionId, 'local-43')
    assert.equal(subscription.data.ConnectionId, 'local-43')
    const nextEvent = once(subscription, 'data')
    connections[1].send('[3,43,{"changed":"after reconnect"}]')
    assert.equal((await nextEvent)[0].changed, 'after reconnect')
    await subscription.close()
    assert.equal(rta._subscriptions.size, 0)
  } finally {
    await rta.close()
    for (const socket of server.clients) socket.terminate()
    await new Promise(resolve => server.close(resolve))
    wsModule.WebSocket = Original
    global.fetch = originalFetch
  }
})
