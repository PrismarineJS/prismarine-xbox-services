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

function createJsonClient (getHeaders, { service, timeout } = {}) {
  const requests = new Set()

  async function request (method, config) {
    const controller = new AbortController()
    requests.add(controller)
    try {
      return await operation(async signal => {
        const authorization = await getHeaders(config)
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
        return readJsonResponse(response, service)
      }, { signal: config.signal, timeout: config.timeout ?? timeout }, controller.signal)
    } finally {
      requests.delete(controller)
    }
  }

  function abortPending () {
    for (const controller of requests) controller.abort(new Error(`${service} request cancelled`))
  }
  return { request, abortPending }
}

module.exports = { createJsonClient }
