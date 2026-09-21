/* eslint-env mocha */
const assert = require('node:assert/strict')
const { once } = require('node:events')
const ws = require('ws')
const { connectRta } = require('..')
const auth = { getXboxToken: async () => ({ userHash: 'hash', XSTSToken: 'token' }) }
const tick = () => new Promise(resolve => setImmediate(resolve))

describe('RTA protocol over local WebSockets', () => {
  let server, originalSocket, originalFetch, connections, requests, connection, respond
  beforeEach(async () => {
    connections = []
    requests = []
    server = new ws.WebSocketServer({ host: '127.0.0.1', port: 0 })
    await once(server, 'listening')
    originalSocket = ws.WebSocket
    originalFetch = global.fetch
    ws.WebSocket = class extends originalSocket {
      constructor (url, protocol) {
        assert.equal(new URL(url).hostname, 'rta.xboxlive.com')
        super(`ws://127.0.0.1:${server.address().port}`, protocol)
      }
    }
    global.fetch = async () => new Response('{"nonce":"nonce"}')
    respond = (socket, [kind, sequence]) => socket.send(JSON.stringify(kind === 1 ? [1, sequence, 0, connections.length * 100 + sequence, { generation: connections.length }] : [2, sequence, 0]))
    server.on('connection', socket => {
      connections.push(socket)
      socket.on('message', raw => {
        const message = JSON.parse(raw)
        requests.push(message)
        respond(socket, message)
      })
    })
  })
  afterEach(async () => {
    await connection?.close()
    connection = undefined
    for (const socket of server.clients) socket.terminate()
    await new Promise(resolve => server.close(resolve))
    ws.WebSocket = originalSocket
    global.fetch = originalFetch
  })

  it('returns a connected emitter, preserves subscriptions, and routes replacement IDs', async () => {
    connection = await connectRta(auth)
    const sub = await connection.subscribe('resource/"quoted"')
    assert.equal(sub.data.generation, 1)
    assert.equal(requests[0][2], 'resource/"quoted"')
    const data = once(sub, 'data')
    connections[0].send('[3,100,{"updated":true}]')
    assert.equal((await data)[0].updated, true)
    const ready = once(sub, 'ready')
    await connection.reconnect()
    assert.equal((await ready)[0].generation, 2)
    assert.equal(sub.data.generation, 2)
    await sub.close()
    assert.equal(sub.closed, true)
    assert.equal(requests.at(-1)[2], 200)
    await sub.close()
  })

  it('rejects explicit request failures without duplicate error events', async () => {
    connection = await connectRta(auth)
    respond = (socket, [kind, sequence]) => socket.send(JSON.stringify([kind, sequence, 1001]))
    await assert.rejects(connection.subscribe('denied'), error => error.code === 1001)
  })

  it('cancels a subscription and removes a late successful remote subscription', async () => {
    connection = await connectRta(auth)
    let receiveRequest
    const received = new Promise(resolve => { receiveRequest = resolve })
    respond = (socket, message) => {
      if (message[0] === 1) receiveRequest({ socket, sequence: message[1] })
      else socket.send(JSON.stringify([2, message[1], 0]))
    }
    const controller = new AbortController()
    const pending = assert.rejects(connection.subscribe('slow', { signal: controller.signal }), /cancel/)
    const remote = await received
    controller.abort(new Error('cancel'))
    await pending
    const unsubscribed = once(connections[0], 'message')
    remote.socket.send(JSON.stringify([1, remote.sequence, 0, 1234, {}]))
    assert.deepEqual(JSON.parse((await unsubscribed)[0]), [2, 1, 1234])
  })

  it('closes pending requests, preserves terminal close, and never silently queues', async () => {
    connection = await connectRta(auth)
    respond = () => {}
    const pending = assert.rejects(connection.subscribe('slow'), /closed/)
    await tick()
    await connection.close()
    await pending
    await assert.rejects(connection.subscribe('later'), /not connected/)
    await assert.rejects(connection.reconnect(), /closed/)
  })

  it('forwards resync and rejects malformed frames without parsing binary data', async () => {
    connection = await connectRta(auth)
    const resync = once(connection, 'resync')
    connections[0].send('[4]')
    await resync
    const error = once(connection, 'error')
    connections[0].send('{}')
    assert.match((await error)[0].message, /Invalid RTA/)
  })

  it('does not carry a startup cancellation signal into reconnect', async () => {
    const controller = new AbortController()
    connection = await connectRta(auth, { signal: controller.signal })
    controller.abort()
    await connection.reconnect()
    await connection.subscribe('still active')
  })

  it('bounds nonce body reading and prevents authentication from issuing late requests', async () => {
    let signal
    global.fetch = async (url, options) => {
      signal = options.signal
      return { ok: true, json: () => new Promise(() => {}) }
    }
    await assert.rejects(connectRta(auth, { timeout: 10 }), /timed out/)
    assert.equal(signal.aborted, true)
    let finish
    let fetched = false
    global.fetch = async () => { fetched = true }
    await assert.rejects(connectRta({ getXboxToken: () => new Promise(resolve => { finish = resolve }) }, { timeout: 10 }), /timed out/)
    finish(await auth.getXboxToken())
    await tick()
    assert.equal(fetched, false)
  })

  it('bounds a WebSocket handshake that never opens', async () => {
    const net = require('node:net')
    const stalledSockets = []
    const stalled = net.createServer(socket => stalledSockets.push(socket))
    stalled.listen(0, '127.0.0.1')
    await once(stalled, 'listening')
    ws.WebSocket = class extends originalSocket {
      constructor () { super(`ws://127.0.0.1:${stalled.address().port}`) }
    }
    try {
      await assert.rejects(connectRta(auth, { timeout: 30 }), /timed out/)
    } finally {
      for (const socket of stalledSockets) socket.destroy()
      await new Promise(resolve => stalled.close(resolve))
    }
  })
  it('closing one subscription during restoration does not break other subscriptions', async () => {
    connection = await connectRta(auth)
    const first = await connection.subscribe('first')
    const second = await connection.subscribe('second')
    let pendingRestore
    const restoring = new Promise(resolve => { pendingRestore = resolve })
    respond = (socket, [kind, sequence, uri]) => {
      if (kind === 1 && uri === 'first' && connections.length === 2) pendingRestore({ socket, sequence })
      else socket.send(JSON.stringify(kind === 1 ? [1, sequence, 0, 200 + sequence, { generation: connections.length }] : [2, sequence, 0]))
    }
    const reconnecting = connection.reconnect()
    const late = await restoring
    await assert.rejects(connection.subscribe('during restoration'), /reconnecting/)
    await first.close()
    await reconnecting
    assert.equal(first.closed, true)
    assert.equal(second.data.generation, 2)
    late.socket.send(JSON.stringify([1, late.sequence, 0, 299, {}]))
    await second.close()
  })

  it('reports a normal server disconnect and allows an explicit reconnect', async () => {
    connection = await connectRta(auth)
    const disconnected = once(connection, 'disconnect')
    connections[0].close(1000, 'done')
    assert.equal((await disconnected)[0], 1000)
    await assert.rejects(connection.subscribe('offline'), /not connected/)
    await connection.reconnect()
    await connection.subscribe('online')
  })

  it('rejects an already-cancelled startup before asking for credentials', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await assert.rejects(connectRta({ getXboxToken: () => assert.fail('must not authenticate') }, { signal: controller.signal }), /cancelled/)
  })
})
