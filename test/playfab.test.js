/* eslint-env mocha */
const assert = require('assert/strict')
const { PlayFabClient, ServiceError } = require('..')
const credentials = async () => ({ SessionTicket: 'ticket', EntityToken: { EntityToken: 'entity' } })

describe('PlayFab service requests', () => {
  let originalFetch
  beforeEach(() => { originalFetch = global.fetch })
  afterEach(() => { global.fetch = originalFetch })

  it('uses title-specific URLs, fresh session tickets, and unwraps data', async () => {
    let calls = 0
    const client = new PlayFabClient(() => ({ SessionTicket: `ticket-${++calls}` }), { titleId: 'AB12' })
    global.fetch = async (url, options) => {
      assert.equal(url, 'https://AB12.playfabapi.com/Client/GetAccountInfo')
      assert.equal(options.headers['X-Authorization'], `ticket-${calls}`)
      assert.equal(options.headers.authorization, undefined)
      assert.equal(options.redirect, 'error')
      assert.equal(options.method, 'POST')
      assert.equal(options.body, '{}')
      return new Response('{"code":200,"data":{"AccountInfo":{"PlayFabId":"player"}}}')
    }
    for (let i = 0; i < 2; i++) {
      const result = await client.request('Client/GetAccountInfo')
      assert.equal(result.AccountInfo.PlayFabId, 'player')
    }
    assert.equal(calls, 2)
  })

  it('isolates entity authentication from session authentication', async () => {
    global.fetch = async (url, options) => {
      assert.equal(options.headers['X-EntityToken'], 'entity')
      assert.equal(options.headers['X-Authorization'], undefined)
      return new Response('{"data":{}}')
    }
    await new PlayFabClient(credentials, { titleId: 'ABC' }).request('Events/WriteEvents', {}, { auth: 'entity' })
  })

  it('retains structured service errors and non-JSON HTTP errors', async () => {
    const client = new PlayFabClient(credentials, { titleId: 'ABC' })
    global.fetch = async () => new Response(JSON.stringify({ error: 'InvalidSessionTicket', errorCode: 1100, errorMessage: 'expired', errorDetails: { ticket: ['expired'] } }), { status: 400 })
    await assert.rejects(client.request('Client/GetAccountInfo'), error => {
      assert(error instanceof ServiceError)
      assert.equal(error.service, 'PlayFab')
      assert.equal(error.status, 400)
      assert.equal(error.code, 'InvalidSessionTicket')
      assert.equal(error.errorCode, 1100)
      assert.deepEqual(error.details, { ticket: ['expired'] })
      return true
    })
    global.fetch = async () => new Response('unavailable', { status: 503 })
    await assert.rejects(client.request('Client/GetAccountInfo'), /503.*unavailable/)
  })

  it('rejects credentials directed outside the title host and missing token types', async () => {
    assert.throws(() => new PlayFabClient(credentials, { titleId: 'abc.attacker.test/' }), /titleId/)
    const client = new PlayFabClient(async () => ({}), { titleId: 'ABC' })
    global.fetch = async () => assert.fail('must not fetch')
    for (const path of ['https://example.com', '//example.com', 'Client/../GetAccountInfo']) {
      await assert.rejects(client.request(path), /API path/)
    }
    await assert.rejects(client.request('Client/GetAccountInfo'), /session ticket/)
    await assert.rejects(client.request('Events/WriteEvents', {}, { auth: 'entity' }), /entity token/)
  })

  it('bounds credential retrieval and prevents requests after timeout', async () => {
    let finish
    global.fetch = async () => assert.fail('must not fetch')
    const client = new PlayFabClient(() => new Promise(resolve => { finish = resolve }), { titleId: 'ABC', timeout: 10 })
    await assert.rejects(client.request('Client/GetAccountInfo'), /timed out/)
    finish(await credentials())
    await new Promise(resolve => setImmediate(resolve))
  })

  it('maps service helpers to session-ticket APIs and preserves CloudScript results', async () => {
    const calls = []
    global.fetch = async (url, options) => {
      calls.push([new URL(url).pathname, JSON.parse(options.body)])
      assert.equal(options.headers['X-Authorization'], 'ticket')
      assert.equal(options.headers['X-EntityToken'], undefined)
      return new Response('{"data":{"Error":{"Error":"ScriptError","Message":"script failed"}}}')
    }
    const client = new PlayFabClient(() => ({ SessionTicket: 'ticket' }), { titleId: 'ABC' })
    await client.getTitleData({ keys: ['ServerList'] })
    await client.getUserInventory()
    const result = await client.executeCloudScript({ functionName: 'Run', functionParameter: { count: 2 }, generatePlayStreamEvent: false })
    assert.equal(result.Error.Error, 'ScriptError')
    assert.deepEqual(calls, [
      ['/Client/GetTitleData', { Keys: ['ServerList'] }],
      ['/Client/GetUserInventory', {}],
      ['/Client/ExecuteCloudScript', { FunctionName: 'Run', FunctionParameter: { count: 2 }, GeneratePlayStreamEvent: false }]
    ])
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await assert.rejects(client.getTitleData({}, { signal: controller.signal }), /cancelled/)
    assert.equal(calls.length, 3)
  })

  it('cancels pending work and allows later requests', async () => {
    const client = new PlayFabClient(credentials, { titleId: 'ABC' })
    global.fetch = async () => new Promise(() => {})
    const pending = assert.rejects(client.request('Client/GetAccountInfo'), /cancelled/)
    client.abortPending()
    await pending
    global.fetch = async () => new Response('{"data":{}}')
    assert.deepEqual({ ...await client.request('Client/GetAccountInfo') }, {})
    const controller = new AbortController()
    controller.abort(new Error('caller cancelled'))
    await assert.rejects(client.request('Client/GetAccountInfo', {}, { signal: controller.signal }), /caller cancelled/)
  })
})
