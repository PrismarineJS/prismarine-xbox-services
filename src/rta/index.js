// Adapted from LucienHH/xbox-rta; see licenses/xbox-rta.txt and docs/provenance.md.
const { EventEmitter } = require('events')
const wsModule = require('ws')
const { MessageType, StatusCode, convertRTAStatus } = require('./constants')
const debug = require('debug')('prismarine-xbox-services:rta')
const address = 'wss://rta.xboxlive.com/connect'

class XboxRTA extends EventEmitter {
  promiseMap = new Map()
  startup = null
  closed = false
  subscriptions = new Map()
  ws = null
  heartbeatTimeout = null
  reconnectTimeout = null
  sequenceId = 0
  constructor (authflow) {
    super()
    this.authflow = authflow
    this.queue = []
  }

  async connect (options = {}) {
    if (this.closed) { throw new Error('RTA connection is closed') }
    if (this.startup || this.ws) { throw new Error('RTA connection already started') }
    await this.init(options)
  }

  async destroy (resume = false) {
    if (!resume) { this.closed = true }
    this.startup?.abort(new Error('RTA connection closed'))
    this.releaseConnection(new Error('RTA connection closed'))
    if (!resume) { this.subscriptions.clear() }
    if (resume && !this.closed) { return this.init() }
  }

  // Shared by server close, failed startup and explicit destruction.
  releaseConnection (error) {
    if (this.heartbeatTimeout) { clearTimeout(this.heartbeatTimeout) }
    if (this.reconnectTimeout) { clearTimeout(this.reconnectTimeout) }
    this.heartbeatTimeout = this.reconnectTimeout = null
    for (const pending of this.promiseMap.values()) { pending.reject(error) }
    this.queue = []
    const ws = this.ws
    this.ws = null
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null
      // Termination also handles CONNECTING sockets and bounds shutdown.
      ws.on('error', () => { })
      ws.terminate()
    }
  }

  async subscribe (uri) {
    debug('Subscribing', uri)
    const sequenceId = this.sequenceId++
    return this.send(MessageType.Subscribe, sequenceId, uri)
  }

  async unsubscribe (subscriptionId) {
    if (!Number.isSafeInteger(subscriptionId) || subscriptionId < 0) throw new TypeError('RTA subscriptionId must be a non-negative integer')
    debug('Unsubscribing', subscriptionId)
    const sequenceId = this.sequenceId++
    return this.send(MessageType.Unsubscribe, sequenceId, subscriptionId)
  }

  async send (type, sequenceId, payload) {
    const data = JSON.stringify([type, sequenceId, payload])
    debug('Sending', data)
    if (this.closed) { throw new Error('RTA connection is closed') }
    return new Promise((resolve, reject) => {
      const sendTimeout = setTimeout(() => onRej(new Error('Timeout')), 30000)
      const cleanup = () => {
        clearTimeout(sendTimeout)
        this.promiseMap.delete(sequenceId)
        this.queue = this.queue.filter(message => message !== data)
      }
      const onRes = (res) => { cleanup(); resolve(res) }
      const onRej = (err) => { cleanup(); reject(err) }
      this.promiseMap.set(sequenceId, { resolve: onRes, reject: onRej, data: payload })
      try {
        if (this.ws?.readyState === wsModule.WebSocket.OPEN) { this.ws.send(data) } else { this.queue.push(data) }
      } catch (error) {
        onRej(error)
      }
    })
  }

  async init (options = {}) {
    if (this.closed) { throw new Error('RTA connection is closed') }
    const controller = new AbortController()
    this.startup = controller
    const abort = () => controller.abort(options.signal?.reason)
    if (options.signal?.aborted) { abort() } else { options.signal?.addEventListener('abort', abort, { once: true }) }
    const timer = setTimeout(() => controller.abort(new Error('RTA startup timed out')), options.timeout ?? 15000)
    let onAbort = () => { }
    const cancelled = new Promise((_resolve, reject) => {
      onAbort = () => reject(controller.signal.reason)
      if (controller.signal.aborted) { onAbort() } else { controller.signal.addEventListener('abort', onAbort, { once: true }) }
    })
    const start = async () => {
      controller.signal.throwIfAborted()
      const xbl = await this.authflow.getXboxToken('http://xboxlive.com', true)
      const authorization = `XBL3.0 x=${xbl.userHash};${xbl.XSTSToken}`
      controller.signal.throwIfAborted()
      const nonceResponse = await fetch('https://rta.xboxlive.com/nonce', {
        headers: { authorization },
        signal: controller.signal,
        redirect: 'error'
      })
      if (!nonceResponse.ok) {
        throw new Error(`Failed to fetch RTA nonce: ${nonceResponse.status} ${nonceResponse.statusText}`)
      }
      const { nonce } = await nonceResponse.json()
      controller.signal.throwIfAborted()
      await this.openSocket(nonce, controller.signal)
    }
    try {
      await Promise.race([start(), cancelled])
    } catch (error) {
      // An older cancelled attempt must not clean up a replacement connection.
      if (this.startup === controller) { this.releaseConnection(error) }
      throw error
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      controller.signal.removeEventListener('abort', onAbort)
      if (this.startup === controller) { this.startup = null }
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
      ws.onclose = event => finish(new Error(`RTA closed before opening: ${event.code} ${event.reason}`))
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
      this.destroy(true).catch(error => {
        if (!this.closed) { this.emit('error', error) }
      })
    }, 90 * 60 * 1000) // 90 minutes
    this.queue.forEach(message => this.ws.send(message))
    this.queue = []
    this.subscriptions.forEach((sub) => {
      if (sub.uri) {
        this.send(sub.type, sub.sequenceId, sub.uri)
          .catch((err) => { debug('Resubscribe failed', err) })
      }
    })
  }

  onError (err) {
    debug('RTA Error', err)
    if (!this.closed) { this.emit('error', err) }
  }

  onClose (code, reason) {
    debug(`RTA Disconnected from ${address} with code ${code} and reason ${reason}`)
    this.releaseConnection(new Error(`RTA connection closed: ${code} ${reason}`))
    this.emit('close', code, reason)
    if (code === 1006 && !this.closed) {
      this.init().catch(error => {
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
      case MessageType.Subscribe: {
        const [type, sequenceId, status, subscriptionId, data] = msgJson
        const promise = this.promiseMap.get(sequenceId)
        if (!promise) return
        if (status !== StatusCode.Success) {
          debug('Subscribe failed', status)
          promise?.reject(new Error(`Subscribe failed with status code ${status} ${convertRTAStatus(status)}`))
          this.emit('error', new Error(`Subscribe failed with status code ${status} ${convertRTAStatus(status)}`))
        } else {
          const sub = { type, sequenceId, status, subscriptionId, data, uri: promise?.data ?? null }
          promise?.resolve(sub)
          this.subscriptions.set(sequenceId, sub)
          this.emit('subscribe', sub)
        }
        break
      }
      case MessageType.Unsubscribe: {
        const [type, sequenceId, status] = msgJson
        const promise = this.promiseMap.get(sequenceId)
        if (!promise) return
        if (status !== StatusCode.Success) {
          debug('Unsubscribe failed', status)
          promise?.reject(new Error(`Unsubscribe failed with status code ${status} ${convertRTAStatus(status)}`))
          this.emit('error', new Error(`Unsubscribe failed with status code ${status} ${convertRTAStatus(status)}`))
        } else {
          for (const [key, sub] of this.subscriptions) {
            if (sub.subscriptionId === promise.data) this.subscriptions.delete(key)
          }
          promise.resolve({ type, sequenceId, status })
          this.emit('unsubscribe', { type, sequenceId, status })
        }
        break
      }
      case MessageType.Event: {
        const [type, subscriptionId, data] = msgJson
        this.emit('event', { type, subscriptionId, data })
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
      this.destroy(true).catch(error => {
        if (!this.closed) { this.emit('error', error) }
      })
    }, 30000)
  }
}

module.exports = { XboxRTA }
