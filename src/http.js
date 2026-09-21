const { parse, stringify } = require('json-bigint')({ storeAsString: true })

async function readJsonResponse (response, service = 'HTTP') {
  const body = await response.text()
  if (!response.ok) {
    const error = new Error(`${service} HTTP ${response.status} ${response.statusText}: ${body}`)
    error.status = response.status
    error.body = body
    throw error
  }
  return body.trim() ? parse(body) : undefined
}

// The deadline covers authentication, HTTP headers, and the response body.
// Racing cancellation also bounds auth flows that cannot themselves be aborted.
async function requestJson (getHeaders, method, config, controller, timeout = 15000, service = 'HTTP') {
  const signal = controller.signal
  const abort = () => controller.abort(config.signal.reason)
  if (config.signal?.aborted) abort()
  else config.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error(`${service} request timed out`)), config.timeout ?? timeout)
  let onAbort
  const cancelled = new Promise((resolve, reject) => {
    onAbort = () => reject(signal.reason)
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
  const execute = async () => {
    signal.throwIfAborted()
    const authorization = await getHeaders()
    signal.throwIfAborted()
    const hasBody = config.data !== undefined
    const headers = {
      ...authorization,
      accept: 'application/json',
      'accept-language': 'en-US',
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      ...config.headers
    }
    if (config.contractVersion) headers['x-xbl-contract-version'] = config.contractVersion
    const response = await fetch(config.url, {
      method,
      headers,
      signal,
      redirect: 'error',
      ...(hasBody ? { body: stringify(config.data) } : {})
    })
    return readJsonResponse(response, service)
  }
  try {
    return await Promise.race([execute(), cancelled])
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
    config.signal?.removeEventListener('abort', abort)
  }
}

class JsonClient {
  constructor (options, service) {
    this.options = { ...options }
    this.service = service
    this.requests = new Set()
  }

  async _request (method, config) {
    const controller = new AbortController()
    this.requests.add(controller)
    try {
      return await requestJson(() => this.getHeaders(config), method, config, controller, this.options.timeout, this.service)
    } finally {
      this.requests.delete(controller)
    }
  }

  abortPending () {
    for (const controller of this.requests) controller.abort(new Error(`${this.service} request cancelled`))
  }
}

module.exports = { JsonClient }
