/* eslint-env mocha */
const assert = require('assert/strict')
const { once } = require('events')
const wsModule = require('ws')
const { XboxRTA } = require('..')

it('exchanges RTA subscriptions and events over a real local WebSocket', async () => {
  const server = new wsModule.WebSocketServer({ port: 0, host: '127.0.0.1' })
  await once(server, 'listening')
  const Original = wsModule.WebSocket
  const originalFetch = global.fetch
  const connections = []
  server.on('connection', socket => {
    connections.push(socket)
    socket.on('message', raw => {
      const [type, sequenceId, payload] = JSON.parse(raw)
      if (type === 1) socket.send(JSON.stringify([1, sequenceId, 0, 42, { ConnectionId: 'local' }]))
      else {
        assert.equal(payload, 42)
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
  const rta = new XboxRTA({ getXboxToken: async () => ({ userHash: 'hash', XSTSToken: 'token' }) })
  try {
    await rta.connect()
    const subscription = await rta.subscribe('https://sessiondirectory.xboxlive.com/connections/')
    assert.equal(subscription.data.ConnectionId, 'local')
    const event = once(rta, 'event')
    connections[0].send('[3,42,{"changed":true}]')
    assert.equal((await event)[0].data.changed, true)
    await rta.unsubscribe(subscription.subscriptionId)
    assert.equal(rta.subscriptions.size, 0)
  } finally {
    await rta.destroy()
    for (const socket of server.clients) socket.terminate()
    await new Promise(resolve => server.close(resolve))
    wsModule.WebSocket = Original
    global.fetch = originalFetch
  }
})
