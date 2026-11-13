import { fetch } from 'fetch'
import Headers from 'headers'
import { Agent, OpenAIResponsesLLM, outputText, ToolSet } from 'stackchan/ai'
import { createVoiceScope } from 'stackchan/voice/scope'
import { assert, equal } from 'testing/assert'
import Timer from 'timer'

const plans = []
const requests = []
const clients = []
class ScriptedClient {
  constructor(options) {
    this.options = options
    clients.push(this)
  }
  close() {
    this.closed = true
  }
  request(options) {
    assert(!this.closed, 'closed clients must not be reused')
    const plan = plans.shift()
    assert(plan, 'request must have a response plan')
    const request = { client: this, options, body: '' }
    requests.push(request)
    const payload = ArrayBuffer.fromString(plan.body ?? '')
    let offset = 0
    const io = {
      write(data) {
        if (data)
          request.body += String.fromArrayBuffer(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
        return 65536
      },
      read(count = payload.byteLength - offset) {
        const result = payload.slice(offset, offset + count)
        offset += count
        return result
      },
    }
    Timer.set(() => {
      options.onWritable.call(io, 65536)
      if (plan.beforeHeaders) {
        options.onDone.call(io, plan.error)
        this.options.onError.call(this, plan.error)
        return
      }
      options.onHeaders.call(io, plan.status ?? 200, new Headers(plan.headers ?? []), 'test')
      Timer.set(() => {
        if (payload.byteLength) options.onReadable.call(io, payload.byteLength)
        options.onDone.call(io, plan.error)
        if (plan.error) this.options.onError.call(this, plan.error)
      })
    })
  }
}

const originalDevice = globalThis.device
globalThis.device = {
  network: {
    http: { client: { io: ScriptedClient, dns: { io: class {} }, socket: {} } },
    https: { client: { io: ScriptedClient, dns: { io: class {} }, socket: {} } },
  },
}
const timeout = Timer.set(() => {
  assert(false, 'fetch/body must settle after network failure')
}, 10000)

function reply(id, text) {
  return {
    body: `data: ${JSON.stringify({
      type: 'response.completed',
      response: {
        id,
        status: 'completed',
        output: [{ id: `message-${id}`, type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
      },
    })}\n\n`,
  }
}

try {
  for (const beforeHeaders of [true, false]) {
    const url = `https://fetch-failure-${beforeHeaders}.test/`
    const error = new Error(beforeHeaders ? 'connection failed' : 'body interrupted')
    plans.push({ beforeHeaders, error, body: '{' })
    let failure
    try {
      await (await fetch(url)).text()
    } catch (caught) {
      failure = caught
    }
    equal(failure, error, 'fetch and body reads preserve the original network error')
    const failedClient = requests[requests.length - 1].client
    assert(failedClient.closed, 'failed fetch client is closed')
    plans.push({ body: 'recovered' })
    equal(await (await fetch(url)).text(), 'recovered', 'fetch recovers on the next request')
    assert(requests[requests.length - 1].client !== failedClient, 'fetch retry uses a new client')
  }

  const agent = Agent.create({
    llm: OpenAIResponsesLLM.create({
      apiKey: 'test-only',
      model: 'test',
      endpoint: 'https://responses.test/v1/responses',
    }),
    tools: ToolSet.create([]),
    instructions: '',
    maxToolRounds: 1,
  })
  let turn = 0
  const message = (text) => ({ type: 'message', role: 'user', content: [{ type: 'input_text', text }] })
  async function run(input) {
    const scope = createVoiceScope()
    try {
      return await agent.run({ input, sessionId: 'test', turnId: String(++turn) }, scope)
    } finally {
      scope.dispose()
    }
  }
  plans.push(reply('first', 'hello'))
  const firstInput = message('hello')
  const initial = await run([firstInput])
  equal(initial.status, 'completed')
  equal(initial.status === 'completed' && outputText(initial.response), 'hello')
  const history = [firstInput, ...initial.appended]
  const savedHistory = JSON.stringify(history)

  for (const beforeHeaders of [true, false]) {
    const error = new Error(beforeHeaders ? 'connection failed' : 'body interrupted')
    plans.push({ beforeHeaders, error, body: '{' })
    const failed = await run([...history, message('fail')])
    equal(failed.status, 'failed', 'network failure becomes a failed Agent result')
    equal(failed.error.code, 'provider_failed')
    assert(failed.error.message.includes(error.message), 'the original network error remains in the Agent result')
    equal(JSON.stringify(history), savedHistory, 'failed response must not mutate caller-owned history')
    equal(JSON.stringify(JSON.parse(requests[requests.length - 1].body).input.slice(0, history.length)), savedHistory)
    const failedClient = requests[requests.length - 1].client
    assert(failedClient.closed, 'failed HTTP client is closed')
    plans.push(reply('recovered', 'recovered'))
    const recovered = await run([...history, message('retry')])
    equal(recovered.status, 'completed', 'next Agent request succeeds')
    equal(recovered.status === 'completed' && outputText(recovered.response), 'recovered')
    equal(
      JSON.stringify(JSON.parse(requests[requests.length - 1].body).input.slice(0, history.length)),
      savedHistory,
      'retry carries the last completed history without the failed response',
    )
    assert(requests[requests.length - 1].client !== failedClient, 'retry uses a new client')
  }

  for (const fromRequest of [true, false]) {
    const url = `http://close-${fromRequest}.test/`
    const options = fromRequest ? { headers: new Headers([['Connection', 'close']]) } : undefined
    plans.push({ headers: fromRequest ? [] : [['Connection', 'close']] }, {})
    await (await fetch(url, options)).text()
    const oldClient = requests[requests.length - 1].client
    await (await fetch(url)).text()
    assert(requests[requests.length - 1].client !== oldClient, 'Connection: close prevents reuse')
  }

  plans.push({ status: 302, headers: [['location', '../final']] }, { body: 'redirected' })
  const redirected = await fetch('http://redirect.test/start/path')
  equal(await redirected.text(), 'redirected')
  equal(redirected.url, 'http://redirect.test/final')
  equal(redirected.redirected, true)
  equal(requests[requests.length - 1].options.path, '/final')

  const count = clients.length
  for (const method of ['POST', 'PUT']) {
    plans.push({ body: 'empty accepted' })
    equal(await (await fetch('http://empty.test/', { method })).text(), 'empty accepted')
    const request = requests[requests.length - 1]
    equal(request.options.method, method)
    equal(request.options.headers.get('content-length'), '0')
    equal(request.body, '')
  }
  equal(clients.length, count + 1, 'healthy keep-alive client is reused')
  equal(plans.length, 0)
  trace('@@STACKCHAN_TEST:PASS@@\n')
} finally {
  Timer.clear(timeout)
  globalThis.device = originalDevice
}
