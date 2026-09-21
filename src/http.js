const { operation } = require('./operation')
const { ServiceError } = require('./errors')
const { parse, stringify } = require('json-bigint')({ storeAsString: true })

async function readJsonResponse (response, service = 'HTTP') {
  const body = await response.text()
  if (!response.ok) {
    let details
    if (service === 'PlayFab') {
      try { details = JSON.parse(body) } catch {}
    }
    throw new ServiceError(service, response.status, body, details)
  }
  return body.trim() ? parse(body) : undefined
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
      return await operation(async signal => {
        const authorization = await this.getHeaders(config)
        signal.throwIfAborted()
        const hasBody = config.data !== undefined
        const headers = {
          ...authorization,
          accept: 'application/json',
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
        return readJsonResponse(response, this.service)
      }, { signal: config.signal, timeout: config.timeout ?? this.options.timeout }, controller.signal)
    } finally {
      this.requests.delete(controller)
    }
  }

  abortPending () {
    for (const controller of this.requests) controller.abort(new Error(`${this.service} request cancelled`))
  }
}

module.exports = { JsonClient }
