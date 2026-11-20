import { ChatGPTDialogue } from 'dialogue-chatgpt'
import { fetch } from 'fetch'
import Headers from 'headers'
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
    const io = {
      write(data) {
        if (data)
          request.body += String.fromArrayBuffer(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
      },
      read() {
        return payload
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
    http: { client: { io: ScriptedClient } },
    https: { client: { io: ScriptedClient } },
  },
}
const timeout = Timer.set(() => {
  assert(false, 'fetch/body must settle after network failure')
}, 10000)

function reply(id, text) {
  return {
    body: JSON.stringify({
      id,
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
    }),
  }
}

try {
  const dialogue = new ChatGPTDialogue({ apiKey: 'test-only' })
  plans.push(reply('first', 'hello'))
  const initial = await dialogue.post('hello')
  equal(initial.success, true)
  equal(initial.success && initial.value, 'hello')

  for (const beforeHeaders of [true, false]) {
    const error = new Error(beforeHeaders ? 'connection failed' : 'body interrupted')
    plans.push({ beforeHeaders, error, body: '{' })
    const failed = await dialogue.post('fail')
    equal(failed.success, false, 'network failure becomes a failed dialogue result')
    equal(failed.success === false && failed.reason, error.message, 'the original network error is preserved')
    equal(JSON.parse(requests[requests.length - 1].body).previous_response_id, 'first')
    const failedClient = requests[requests.length - 1].client
    assert(failedClient.closed, 'failed HTTP client is closed')
    plans.push(reply('first', 'recovered'))
    const recovered = await dialogue.post('retry')
    equal(recovered.success, true, 'next dialogue request succeeds')
    equal(recovered.success && recovered.value, 'recovered')
    equal(
      JSON.parse(requests[requests.length - 1].body).previous_response_id,
      'first',
      'failed body must not replace conversation ID',
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
