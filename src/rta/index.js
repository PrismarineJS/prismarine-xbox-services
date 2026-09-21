// Adapted from https://github.com/LucienHH/xbox-rta.
const { EventEmitter } = require('events')
const { operation } = require('../operation')
const { RtaSubscription } = require('./subscription')
const wsModule = require('ws')
const { MessageType, StatusCode, convertRTAStatus, SocketError, SocketClosedError, SocketNotConnectedError, SocketAlreadyConnectedError } = require('./constants')
const debug = require('debug')('prismarine-xbox-services:rta')
const address = 'wss://rta.xboxlive.com/connect'

class XboxRTASocket extends EventEmitter {
  promiseMap = new Map()
  startup = null
  closed = false
  _subscriptions = new Set()
  ws = null
  heartbeatTimeout = null
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
    if (this.heartbeatTimeout) { clearTimeout(this.heartbeatTimeout) }
    if (this.reconnectTimeout) { clearTimeout(this.reconnectTimeout) }
    this.heartbeatTimeout = this.reconnectTimeout = null
    for (const pending of this.promiseMap.values()) { pending.reject(error) }
    const ws = this.ws
    this.ws = null
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null
      // Termination also handles CONNECTING sockets and bounds shutdown.
      ws.on('error', () => { })
      ws.terminate()
    }
  }

  async subscribe (uri, options = {}) {
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
    if (this.ws?.readyState === wsModule.WebSocket.OPEN && subscription._id !== null) {
      await this.send(MessageType.Unsubscribe, subscription._id)
    }
  }

  async send (type, payload, options = {}) {
    if (this.closed) throw new SocketClosedError()
    if (this.ws?.readyState !== wsModule.WebSocket.OPEN) throw new SocketNotConnectedError()
    const socket = this.ws
    const sequenceId = this.sequenceId++
    const data = JSON.stringify([type, sequenceId, payload])
    try {
      return await operation(signal => new Promise((resolve, reject) => {
        this.promiseMap.set(sequenceId, { resolve, reject, type, signal })
        signal.throwIfAborted()
        if (this.ws !== socket) throw new SocketClosedError()
        socket.send(data)
      }), { signal: options.signal, timeout: options.timeout ?? 30000 })
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
      const nonceResponse = await fetch('https://rta.xboxlive.com/nonce', {
        headers: { authorization },
        signal,
        redirect: 'error'
      })
      if (!nonceResponse.ok) {
        throw new Error(`Failed to fetch RTA nonce: ${nonceResponse.status} ${nonceResponse.statusText}`)
      }
      const { nonce } = await nonceResponse.json()
      signal.throwIfAborted()
      await this.openSocket(nonce, signal)
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

  openSocket (nonce, signal) {
    signal.throwIfAborted()
    const ws = new wsModule.WebSocket(`${address}?nonce=${encodeURIComponent(nonce)}`, 'rta.xboxlive.com.V2')
    this.ws = ws
    return new Promise((resolve, reject) => {
      const onAbort = () => finish(signal.reason)
      const finish = (error) => {
        signal.removeEventListener('abort', onAbort)
        if (error) { reject(error) } else { resolve() }
      }
      signal.addEventListener('abort', onAbort, { once: true })
      ws.onerror = event => finish(event.error)
      ws.onclose = event => finish(new SocketClosedError(`RTA closed before opening: ${event.code} ${event.reason}`))
      ws.onopen = () => {
        if (signal.aborted) { return onAbort() }
        ws.onerror = event => {
          if (this.ws === ws) { this.onError(event.error) }
        }
        ws.onclose = event => {
          if (this.ws === ws) { this.onClose(event.code, event.reason) }
        }
        ws.onmessage = event => {
          if (this.ws === ws) { this.onMessage(event.data) }
        }
        ws.on('pong', () => {
          if (this.ws === ws) { this.heartbeat() }
        })
        try {
          this.onOpen()
          finish()
        } catch (error) {
          finish(error)
        }
      }
    })
  }

  onOpen () {
    debug('RTA Connected to', address)
    this.reconnectTimeout = setTimeout(() => {
      debug(`Reconnecting to ${address}`)
      this.reconnect().catch(error => {
        if (!this.closed) { this.emit('error', error) }
      })
    }, 90 * 60 * 1000) // 90 minutes
    for (const subscription of this._subscriptions) {
      subscription._id = null
      this._subscribe(subscription).catch(error => {
        if (!this.closed && !subscription.closed) this.emit('error', error)
      })
    }
  }

  onError (err) {
    debug('RTA Error', err)
    if (!this.closed) { this.emit('error', err) }
  }

  onClose (code, reason) {
    debug(`RTA Disconnected from ${address} with code ${code} and reason ${reason}`)
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
          if (type === MessageType.Subscribe && status === StatusCode.Success && this.ws?.readyState === wsModule.WebSocket.OPEN) {
            this.send(MessageType.Unsubscribe, subscriptionId).catch(error => {
              if (!this.closed) this.emit('error', error)
            })
          }
          return
        }
        if (pending.type !== type) return
        this.promiseMap.delete(sequenceId)
        if (status !== StatusCode.Success) {
          pending.reject(new Error(`RTA request failed: ${status} ${convertRTAStatus(status)}`))
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

  heartbeat () {
    debug('RTA Pinged')
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout)
    }
    this.heartbeatTimeout = setTimeout(() => {
      debug('RTA Ping Timeout')
      this.reconnect().catch(error => {
        if (!this.closed) { this.emit('error', error) }
      })
    }, 30000)
  }
}

module.exports = { XboxRTASocket }
