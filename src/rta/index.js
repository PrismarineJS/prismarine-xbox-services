// Adapted from https://github.com/LucienHH/xbox-rta.
const { EventEmitter, once } = require('events')
const { operation } = require('../operation')
const { RtaSubscription } = require('./subscription')
const { ServiceError } = require('../errors')
const { MessageType, StatusCode, RTARequestError, SocketError, SocketClosedError, SocketNotConnectedError, SocketAlreadyConnectedError } = require('./constants')
const debug = require('debug')('prismarine-xbox-services:rta')
const NONCE_URL = 'https://rta.xboxlive.com/nonce'
const SOCKET_URL = 'wss://rta.xboxlive.com/connect'
const SOCKET_PROTOCOL = 'rta.xboxlive.com.V2'
const CONNECTION_RENEWAL_MS = 90 * 60 * 1000
const REQUEST_TIMEOUT_MS = 30_000

class XboxRTASocket extends EventEmitter {
  promiseMap = new Map()
  startup = null
  closed = false
  _subscriptions = new Set()
  ws = null
  reconnectTimeout = null
  sequenceId = 0
  constructor (authflow) {
    super()
    this.authflow = authflow
  }

  async connect (options = {}) {
    if (this.closed) { throw new SocketClosedError() }
    if (this.startup || this.ws) { throw new SocketAlreadyConnectedError() }
    this.options = { timeout: options.timeout }
    await this.init(options)
  }

  async close () {
    if (this.closed) return
    this.closed = true
    this.startup?.abort(new SocketClosedError())
    this.releaseConnection(new SocketClosedError())
    for (const subscription of this._subscriptions) subscription._dispose()
    this._subscriptions.clear()
  }

  async reconnect () {
    if (this.closed) throw new SocketClosedError()
    this.startup?.abort(new SocketError('RTA connection reconnecting'))
    this.releaseConnection(new SocketError('RTA connection reconnecting'))
    return this.init(this.options)
  }

  // Shared by server close, failed startup and explicit destruction.
  releaseConnection (error) {
    if (this.reconnectTimeout) { clearTimeout(this.reconnectTimeout) }
    this.reconnectTimeout = null
    for (const subscription of this._subscriptions) subscription._id = null
    for (const pending of this.promiseMap.values()) { pending.reject(error) }
    const ws = this.ws
    this.ws = null
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null
      // Release local work immediately; native WebSocket owns transport shutdown.
      ws.close()
    }
  }

  async subscribe (uri, options = {}) {
    if (this.closed) throw new SocketClosedError()
    if (this.startup) throw new SocketNotConnectedError()
    const subscription = new RtaSubscription(this, uri)
    try {
      await this._subscribe(subscription, options)
      this._subscriptions.add(subscription)
      return subscription
    } catch (error) {
      subscription._dispose()
      this._subscriptions.delete(subscription)
      throw error
    }
  }

  async _subscribe (subscription, options = {}) {
    const response = await this.send(MessageType.Subscribe, subscription.uri, {
      ...options, signal: AbortSignal.any([subscription._lifetime.signal, ...[options.signal].filter(Boolean)])
    })
    options.signal?.throwIfAborted()
    if (this.closed) throw new SocketClosedError()
    if (subscription.closed) {
      await this.send(MessageType.Unsubscribe, response.subscriptionId)
      subscription._lifetime.signal.throwIfAborted()
    }
    subscription._id = response.subscriptionId
    subscription.data = response.data
    subscription.emit('ready', response.data)
  }

  async _unsubscribe (subscription) {
    this._subscriptions.delete(subscription)
    if (this.ws?.readyState === globalThis.WebSocket.OPEN && subscription._id !== null) {
      await this.send(MessageType.Unsubscribe, subscription._id)
    }
  }

  async send (type, payload, options = {}) {
    if (this.closed) throw new SocketClosedError()
    if (this.ws?.readyState !== globalThis.WebSocket.OPEN) throw new SocketNotConnectedError()
    const socket = this.ws
    const sequenceId = this.sequenceId++
    const data = JSON.stringify([type, sequenceId, payload])
    try {
      return await operation(signal => new Promise((resolve, reject) => {
        this.promiseMap.set(sequenceId, { resolve, reject, type, signal })
        signal.throwIfAborted()
        if (this.ws !== socket) throw new SocketClosedError()
        socket.send(data)
      }), { signal: options.signal, timeout: options.timeout ?? REQUEST_TIMEOUT_MS })
    } finally {
      this.promiseMap.delete(sequenceId)
    }
  }

  async init (options = {}) {
    if (this.closed) { throw new SocketClosedError() }
    const controller = new AbortController()
    this.startup = controller
    const start = async signal => {
      signal.throwIfAborted()
      const xbl = await this.authflow.getXboxToken('http://xboxlive.com')
      const authorization = `XBL3.0 x=${xbl.userHash};${xbl.XSTSToken}`
      signal.throwIfAborted()
      const nonceResponse = await fetch(NONCE_URL, {
        headers: { authorization },
        signal,
        redirect: 'error'
      })
      if (!nonceResponse.ok) {
        throw new ServiceError('Xbox RTA', nonceResponse.status, await nonceResponse.text())
      }
      const { nonce } = await nonceResponse.json()
      signal.throwIfAborted()
      await this.openSocket(nonce, signal)
      await this.onOpen(signal)
    }
    try {
      await operation(start, options, controller.signal)
    } catch (error) {
      // An older cancelled attempt must not clean up a replacement connection.
      if (this.startup === controller) this.releaseConnection(error)
      throw error
    } finally {
      if (this.startup === controller) this.startup = null
    }
  }

  async openSocket (nonce, signal) {
    signal.throwIfAborted()
    const socket = new globalThis.WebSocket(`${SOCKET_URL}?nonce=${encodeURIComponent(nonce)}`, SOCKET_PROTOCOL)
    this.ws = socket
    socket.onerror = event => {
      if (this.ws !== socket) return
      const error = event.error || new SocketError(event.message || 'RTA WebSocket failed')
      if (this.startup) this.startup.abort(error)
      else this.onError(error)
    }
    socket.onclose = ({ code, reason }) => {
      if (this.ws !== socket) return
      if (this.startup) this.startup.abort(new SocketClosedError(`RTA connection closed: ${code} ${reason}`))
      else this.onClose(code, reason)
    }
    socket.onmessage = event => {
      if (this.ws === socket) this.onMessage(event.data)
    }
    await once(socket, 'open', { signal })
    signal.throwIfAborted()
  }

  async onOpen (signal) {
    await Promise.all([...this._subscriptions].map(async subscription => {
      subscription._id = null
      try {
        await this._subscribe(subscription, { signal })
      } catch (error) {
        if (!subscription.closed) throw error
      }
    }))
    signal?.throwIfAborted()
    debug('RTA connected and subscriptions restored')
    this.reconnectTimeout = setTimeout(() => {
      this.reconnect().catch(error => {
        if (!this.closed) this.emit('error', error)
      })
    }, CONNECTION_RENEWAL_MS)
  }

  onError (err) {
    debug('RTA Error', err)
    if (!this.closed) { this.emit('error', err) }
  }

  onClose (code, reason) {
    debug(`RTA disconnected: ${code} ${reason}`)
    this.releaseConnection(new SocketClosedError(`RTA connection closed: ${code} ${reason}`))
    this.emit('close', code, reason)
    if (code === 1006 && !this.closed) {
      this.init(this.options).catch(error => {
        if (!this.closed) { this.emit('error', error) }
      })
    }
  }

  onMessage (res) {
    if (!(typeof res === 'string')) { return debug('Received non-string message', res) }
    let msgJson
    try {
      msgJson = JSON.parse(res)
      if (!Array.isArray(msgJson)) throw new Error('Invalid RTA message: expected an array')
    } catch (error) {
      this.emit('error', error)
      return
    }
    if (this.closed) return
    const messageType = msgJson[0]
    debug('Received message', res)
    switch (messageType) {
      case MessageType.Subscribe:
      case MessageType.Unsubscribe: {
        const [type, sequenceId, status, subscriptionId, data] = msgJson
        const pending = this.promiseMap.get(sequenceId)
        if (!pending || pending.signal.aborted) {
          this.promiseMap.delete(sequenceId)
          if (type === MessageType.Subscribe && status === StatusCode.Success && this.ws?.readyState === globalThis.WebSocket.OPEN) {
            this.send(MessageType.Unsubscribe, subscriptionId).catch(error => {
              if (!this.closed) this.emit('error', error)
            })
          }
          return
        }
        if (pending.type !== type) return
        this.promiseMap.delete(sequenceId)
        if (status !== StatusCode.Success) {
          pending.reject(new RTARequestError(status))
        } else {
          pending.resolve({ subscriptionId, data })
        }
        break
      }
      case MessageType.Event: {
        const [, subscriptionId, data] = msgJson
        for (const subscription of this._subscriptions) {
          if (subscription._id === subscriptionId) subscription.emit('data', data)
        }
        break
      }
      case MessageType.Resync: {
        this.emit('resync')
        break
      }
      default:
        debug('Received unknown message', res)
        break
    }
  }
}

module.exports = { XboxRTASocket }
