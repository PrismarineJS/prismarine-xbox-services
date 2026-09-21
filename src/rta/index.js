const { EventEmitter, once } = require('node:events')
const ws = require('ws')
const { operation } = require('../operation')

// RTA v2 wire message kinds. See docs/references.md for the protocol references.
const SUBSCRIBE = 1
const UNSUBSCRIBE = 2
const NOTIFICATION = 3
const RESYNC = 4

async function connectRta (auth, options = {}) {
  const events = new EventEmitter()
  const subscriptions = new Set()
  let connection
  let opening
  let closed = false

  function release (current, reason) {
    if (!current || current.abort.signal.aborted) return
    current.abort.abort(reason)
    clearInterval(current.heartbeat)
    clearTimeout(current.renewal)
    current.socket?.terminate()
    if (connection === current) {
      connection = undefined
      for (const record of subscriptions) record.id = undefined
    }
  }

  function report (error) {
    if (!closed) queueMicrotask(() => { if (!closed) events.emit('error', error) })
  }

  async function request (kind, payload, config = {}, accept) {
    const current = connection
    if (closed || current?.socket?.readyState !== ws.OPEN) throw new Error('RTA is not connected')
    const sequence = current.sequence++
    try {
      return await operation(signal => new Promise((resolve, reject) => {
        current.pending.set(sequence, { kind, signal, resolve, reject, accept })
        current.socket.send(JSON.stringify([kind, sequence, payload]), error => {
          if (error) reject(error)
        })
      }), { signal: config.signal, timeout: config.timeout ?? 30000 }, current.abort.signal)
    } finally {
      current.pending.delete(sequence)
    }
  }

  function receive (current, buffer, binary) {
    if (connection !== current || binary) return
    let message
    try {
      message = JSON.parse(buffer.toString())
      if (!Array.isArray(message)) throw new Error('Invalid RTA message')
    } catch (error) { report(error); return }
    const [kind, id, status, subscriptionId, data] = message
    if (kind === RESYNC) return events.emit('resync')
    if (kind === NOTIFICATION) {
      for (const record of subscriptions) {
        if (record.id === id && !record.abort.signal.aborted) record.events.emit('data', status)
      }
      return
    }
    if (kind !== SUBSCRIBE && kind !== UNSUBSCRIBE) return
    const pending = current.pending.get(id)
    if (!pending || pending.signal.aborted) {
      if (kind === SUBSCRIBE && status === 0) request(UNSUBSCRIBE, subscriptionId).catch(report)
      return
    }
    if (pending.kind !== kind) return
    if (status !== 0) {
      const error = new Error(`RTA request failed with status ${status}`)
      error.code = status
      pending.reject(error)
    } else {
      pending.accept?.(subscriptionId, data)
      pending.resolve(data)
    }
    current.pending.delete(id)
  }

  async function restore (record, config) {
    await request(SUBSCRIBE, record.uri, {
      ...config, signal: AbortSignal.any([record.abort.signal, ...[config?.signal].filter(Boolean)])
    }, (id, data) => {
      record.id = id
      record.data = data
    })
    if (record.abort.signal.aborted) return
    record.events.emit('ready', record.data)
  }

  async function open (config) {
    const current = { abort: new AbortController(), pending: new Map(), sequence: 0 }
    connection = current
    try {
      await operation(async signal => {
        const token = await auth.getXboxToken('http://xboxlive.com')
        signal.throwIfAborted()
        const response = await fetch('https://rta.xboxlive.com/nonce', {
          headers: { authorization: `XBL3.0 x=${token.userHash};${token.XSTSToken}` },
          signal,
          redirect: 'error'
        })
        if (!response.ok) throw new Error(`RTA nonce HTTP ${response.status}`)
        const { nonce } = await response.json()
        signal.throwIfAborted()
        const socket = current.socket = new ws.WebSocket(`wss://rta.xboxlive.com/connect?nonce=${encodeURIComponent(nonce)}`, 'rta.xboxlive.com.V2')
        let opened = false
        let alive = true
        socket.on('error', error => { if (opened && connection === current) report(error) })
        socket.on('message', (data, binary) => receive(current, data, binary))
        socket.on('pong', () => { alive = true })
        socket.on('close', (code, reason) => {
          if (connection !== current) return
          release(current, new Error(`RTA disconnected: ${code} ${reason}`))
          if (opened && !closed) {
            events.emit('disconnect', code, reason.toString())
            if (code === 1006) reconnect().catch(report)
          }
        })
        await once(socket, 'open', { signal })
        signal.throwIfAborted()
        opened = true
        current.heartbeat = setInterval(() => {
          if (!alive) { reconnect().catch(report); return }
          alive = false
          socket.ping()
        }, 30000)
        current.heartbeat.unref()
        current.renewal = setTimeout(() => reconnect().catch(report), 90 * 60 * 1000)
        current.renewal.unref()
        for (const record of subscriptions) {
          if (record.abort.signal.aborted) continue
          try { await restore(record, { signal, timeout: config.timeout }) } catch (error) {
            if (!record.abort.signal.aborted || signal.aborted) throw error
          }
        }
      }, config, current.abort.signal)
    } catch (error) {
      release(current, error)
      throw error
    }
  }

  function reconnect (config = {}) {
    if (closed) return Promise.reject(new Error('RTA is closed'))
    if (opening) return opening
    release(connection, new Error('RTA reconnecting'))
    opening = open({ timeout: options.timeout, ...config }).finally(() => { opening = undefined })
    return opening
  }

  async function subscribe (uri, config = {}) {
    if (opening) throw new Error('RTA is reconnecting')
    const record = { uri, events: new EventEmitter(), abort: new AbortController(), id: undefined, data: undefined }
    let closing
    function close () {
      if (closing) return closing
      subscriptions.delete(record)
      record.abort.abort(new Error('Subscription closed'))
      closing = (connection?.socket?.readyState === ws.OPEN && record.id !== undefined
        ? request(UNSUBSCRIBE, record.id)
        : Promise.resolve()).then(() => undefined)
      return closing
    }
    Object.assign(record.events, { close })
    Object.defineProperties(record.events, {
      uri: { value: uri, enumerable: true },
      data: { get: () => record.data, enumerable: true },
      closed: { get: () => record.abort.signal.aborted, enumerable: true }
    })
    subscriptions.add(record)
    try {
      await restore(record, config)
      return record.events
    } catch (error) {
      subscriptions.delete(record)
      record.abort.abort(error)
      if (record.id !== undefined) request(UNSUBSCRIBE, record.id).catch(report)
      throw error
    }
  }

  function close () {
    if (closed) return Promise.resolve()
    closed = true
    release(connection, new Error('RTA closed'))
    for (const record of subscriptions) record.abort.abort(new Error('RTA closed'))
    subscriptions.clear()
    events.emit('close')
    return Promise.resolve()
  }

  Object.assign(events, { subscribe, reconnect, close })
  try {
    await reconnect(options)
    return events
  } catch (error) {
    await close()
    throw error
  }
}

module.exports = { connectRta }
