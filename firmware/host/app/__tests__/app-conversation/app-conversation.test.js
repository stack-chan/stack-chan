import { createAppConversation } from 'app-conversation'
import { CancellationSource } from 'cancellation'
import { ResourceScope } from 'owned-resources'
import { StackchanError } from 'stackchan/errors'
import { TaskScope } from 'task-scope'
import { assert, equal } from 'testing/assert'
import Timer from 'timer'

async function rejects(promise, code) {
  try {
    await promise
  } catch (error) {
    equal(error.code, code)
    return
  }
  throw new Error(`Expected ${code}`)
}
function scope() {
  const resources = new ResourceScope(),
    tasks = new TaskScope({
      now: () => 0,
      after(ms, callback) {
        const timer = Timer.set(callback, ms)
        return () => Timer.clear(timer)
      },
    })
  return {
    call(fn) {
      if (resources.closed) throw new StackchanError('CLOSED', 'App closed')
      return fn()
    },
    run: (fn, signal) => tasks.run(fn, signal),
    own(fn) {
      let pending
      const close = () => (pending ??= Promise.resolve().then(fn).finally(release))
      const release = resources.defer(close)
      return close
    },
    report(error) {
      throw error
    },
    async close() {
      await tasks.close()
      await resources.close()
    },
    get size() {
      return resources.size + tasks.size
    },
  }
}
const settings = { get: (key) => (key === 'ai.token' ? 'openai-only-key' : '') }
const audio = {
  reserveStream: () => () => {},
  failStream(error) {
    throw error
  },
}
function reply(provider, text) {
  if (provider === 'openai')
    return {
      id: `id-${text}`,
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
    }
  if (provider === 'claude')
    return {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'private' },
        { type: 'text', text },
      ],
    }
  return { candidates: [{ content: { role: 'model', parts: [{ thought: true, text: 'private' }, { text }] } }] }
}
async function run() {
  {
    const owner = scope()
    let requests = 0
    const chat = createAppConversation(owner, settings, audio, undefined, async () => {
      requests++
      throw new Error('must not send')
    })
    for (const [options, code] of [
      [null, 'INVALID_ARGUMENT'],
      [{ provider: 'unknown' }, 'INVALID_ARGUMENT'],
      [{ provider: 'claude', model: 'configured-model' }, 'CONFIG'],
      [{ provider: 'gemini', apiKey: 'provider-key' }, 'CONFIG'],
      [
        { provider: 'gemini', apiKey: 'provider-key', model: 'configured-model', tools: [{ name: 'tool' }] },
        'UNSUPPORTED',
      ],
    ]) {
      let reason
      try {
        chat.dialogue(options)
      } catch (error) {
        reason = error.code
      }
      equal(reason, code)
    }
    equal(requests, 0, 'invalid provider selection never sends a key')
    equal(owner.size, 0, 'validation fails before a connection is registered')
    await owner.close()
  }
  for (let cycle = 0; cycle < 100; cycle++) {
    for (const provider of ['openai', 'claude', 'gemini']) {
      const owner = scope(),
        requests = []
      let mode = 'success',
        turn = 0
      const chat = createAppConversation(owner, settings, audio, undefined, async (request) => {
        const body = JSON.parse(request.body)
        requests.push(body)
        equal(request.method, 'POST')
        if (provider === 'openai') {
          equal(request.url, 'https://api.openai.com/v1/responses')
          equal(request.headers.Authorization, 'Bearer openai-only-key')
        } else {
          assert(!request.headers.Authorization, 'a provider key must not become an OpenAI bearer token')
          assert(!request.url.includes('key='), 'provider secrets stay out of the URL')
          equal(request.headers[provider === 'claude' ? 'x-api-key' : 'x-goog-api-key'], 'provider-specific-key')
          equal(body.system ?? body.systemInstruction.parts[0].text, 'short replies')
        }
        return { status: 200, body: JSON.stringify(mode === 'success' ? reply(provider, `reply-${++turn}`) : {}) }
      })
      const messages = [
        { role: 'user', content: 'seed' },
        { role: 'assistant', content: 'welcome' },
      ]
      const dialogue = chat.dialogue({
        provider,
        instructions: 'short replies',
        messages,
        ...(provider === 'openai' ? {} : { apiKey: 'provider-specific-key', model: 'configured-model' }),
      })
      messages[0].content = 'mutated seed'
      for (let i = 0; i < 5; i++) equal(await dialogue.ask(`ask-${i}`), `reply-${i + 1}`)
      equal(dialogue.history.length, 6)
      equal(dialogue.history[0].content, 'ask-2')
      const snapshot = dialogue.history
      snapshot[0].content = 'mutated history'
      equal(dialogue.history[0].content, 'ask-2')
      mode = 'invalid'
      await rejects(dialogue.ask('failed turn'), 'IO')
      mode = 'success'
      await dialogue.ask('retry')
      const sent = requests[requests.length - 1]
      if (provider === 'openai') equal(sent.previous_response_id, 'id-reply-5')
      else {
        const list = sent.messages ?? sent.contents
        equal(list.length, 9, 'two seeds, three successful pairs and current question')
        equal(list[0].content ?? list[0].parts[0].text, 'seed')
        assert(!JSON.stringify(list).includes('failed turn'), 'failed question must not be committed')
        assert(!JSON.stringify(list).includes('private'), 'reasoning text must not become speech or visible history')
      }
      dialogue.clear()
      equal(dialogue.history.length, 0)
      await dialogue.ask('after clear')
      const cleared = requests[requests.length - 1]
      equal(cleared.previous_response_id, undefined)
      equal((cleared.input ?? cleared.messages ?? cleared.contents).length, 3)
      await dialogue.close()
      await dialogue.close()
      await rejects(dialogue.ask('closed'), 'CLOSED')
      await owner.close()
      equal(owner.size, 0)
    }
  }
  // Closing or cancelling each provider while HTTP is pending must suppress its late answer.
  for (const provider of ['openai', 'claude', 'gemini']) {
    const owner = scope(),
      source = new CancellationSource()
    let resolve, entered
    const started = new Promise((done) => {
      entered = done
    })
    const chat = createAppConversation(owner, settings, audio, undefined, () => {
      entered()
      return new Promise((done) => {
        resolve = done
      })
    })
    const dialogue = chat.dialogue({ provider, apiKey: 'explicit-key', model: 'configured-model' })
    const pending = rejects(dialogue.ask('waiting', { signal: source.signal }), 'CANCELLED')
    await started
    await rejects(dialogue.ask('busy'), 'BUSY')
    let clearError
    try {
      dialogue.clear()
    } catch (error) {
      clearError = error.code
    }
    equal(clearError, 'BUSY')
    source.cancel()
    await pending
    resolve({ status: 200, body: JSON.stringify(reply(provider, 'late')) })
    await new Promise((done) => Timer.set(done, 1))
    equal(dialogue.history.length, 0)
    await owner.close()
    equal(owner.size, 0)
  }
  for (let cycle = 0; cycle < 100; cycle++) {
    const owner = scope(),
      requests = []
    let deleteCount = 0
    const chat = createAppConversation(owner, settings, audio, undefined, async (request, signal) => {
      if (request.method === 'DELETE') {
        deleteCount++
        equal(request.headers['Mcp-Session-Id'], `session-${cycle}`)
        return { status: 204, body: '' }
      }
      signal.throwIfCancelled()
      const message = JSON.parse(request.body)
      requests.push(message.method)
      let result
      if (message.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} } }
      else {
        equal(request.headers['Mcp-Session-Id'], `session-${cycle}`)
        equal(request.headers['MCP-Protocol-Version'], '2025-06-18')
        if (message.method === 'notifications/initialized') {
          equal(message.id, undefined)
          return { status: 202, body: '' }
        }
        result =
          message.method === 'tools/list'
            ? { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }
            : { content: [{ type: 'text', text: message.params.arguments.text }], structuredContent: { count: 1 } }
      }
      const data = { jsonrpc: '2.0', id: message.id, result }
      return {
        status: 200,
        headers: { 'mcp-session-id': `session-${cycle}`, 'content-type': 'text/event-stream' },
        body: `: ping\r\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message' })}\r\n\r\ndata:${JSON.stringify(data)}\r\n\r\n`,
      }
    })
    const connection = await chat.connectTools({ url: 'http://mcp.local/mcp', token: 'remote-token' })
    equal(requests.join(','), 'initialize,notifications/initialized,tools/list')
    equal(connection.tools.length, 1)
    const result = await owner.run((task) => connection.tools[0].execute({ text: 'hello' }, task))
    equal(JSON.parse(result).content[0].text, 'hello')
    equal(JSON.parse(result).structuredContent.count, 1)
    await connection.close()
    await connection.close()
    equal(deleteCount, 1)
    await rejects(
      owner.run((task) => connection.tools[0].execute({}, task)),
      'CLOSED',
    )
    await owner.close()
    equal(owner.size, 0)
  }
  trace('ok\n')
}
run().catch((error) => {
  trace(`conversation test failed: ${error}\n`)
  throw error
})
