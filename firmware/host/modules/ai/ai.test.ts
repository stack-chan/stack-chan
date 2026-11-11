import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inflateSync } from 'node:zlib'
import type { FunctionCall, InputItem, LLM, ModelResponse } from '../voice/contracts.js'
import { createVoiceScope } from '../voice/scope.js'
import type { ResponseConnection } from './ai-http-stream.js'
import { writeAliasPackage } from '../testing/node-alias-package.js'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = dirname(fileURLToPath(import.meta.url))
for (const name of ['ai-core', 'ai-image', 'ai-wire', 'ai-responses']) {
  writeAliasPackage(resolve(directory, '../../..'), 'stackchan-' + name, resolve(directory, name + '.js'))
}
const { asDelegateAgent, createAgent, createToolSet, createVision, outputText } = await import('./ai-core.js')
const { createResponsesLLM, prepareBody } = await import('./ai-responses.js')
const { streamResponse } = await import('./ai-http-stream.js')
const { createChatLLM } = await import('./ai-chat.js')

ArrayBuffer.fromString ??= (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer
String.fromArrayBuffer ??= (b: ArrayBuffer) => new TextDecoder().decode(b)
const call: FunctionCall = {
  type: 'function_call',
  id: 'item',
  call_id: 'call',
  name: 'move',
  arguments: '{"angle":10}',
}
const message = {
  type: 'message' as const,
  id: 'message',
  role: 'assistant' as const,
  phase: 'final_answer' as const,
  content: [{ type: 'output_text' as const, text: 'はい' }],
}
const result: ModelResponse = { status: 'completed', id: 'response', output: [message] }
const tool = {
  definition: {
    type: 'function' as const,
    name: 'move',
    description: 'move head',
    parameters: {
      type: 'object',
      properties: { angle: { type: 'integer' } },
      required: ['angle'],
      additionalProperties: false,
    },
  },
  execute: () => 'moved',
}

test('Responses sends exact PNG colors from both RGB565 byte orders without materializing a base64 image', () => {
  for (const format of ['rgb565le', 'rgb565be'] as const) {
    const image = {
      format,
      width: 3,
      height: 1,
      data: Uint8Array.from(format === 'rgb565le' ? [0, 248, 224, 7, 31, 0] : [248, 0, 7, 224, 0, 31]),
    }
    const body = prepareBody(
      {
        input: [
          {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: '色は？' },
              { type: 'input_image', image },
            ],
          },
        ],
      },
      'model',
      'p',
      4096,
    )
    const bytes = Buffer.concat([...body.read()])
    assert.equal(bytes.length, body.length)
    const wire = JSON.parse(bytes.toString()).input[0].content
    assert.equal(wire[0].text, '色は？')
    const png = Buffer.from(wire[1].image_url.split(',')[1], 'base64')
    const deflate = []
    for (let offset = 8; offset < png.length; ) {
      const len = png.readUInt32BE(offset)
      if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT')
        deflate.push(png.subarray(offset + 8, offset + 8 + len))
      offset += len + 12
    }
    assert.deepEqual([...inflateSync(Buffer.concat(deflate))], [0, 255, 0, 0, 0, 255, 0, 0, 0, 255])
  }
})

test('fragmented Responses SSE preserves Japanese text, ordered callback waits, and opaque reasoning items', async () => {
  const reasoning = { type: 'reasoning', id: 'r', encrypted_content: 'sealed' }
  const events = [
    { type: 'response.output_item.added', item: { type: 'message', id: 'message', phase: 'final_answer' } },
    { type: 'response.output_text.delta', item_id: 'message', delta: 'は' },
    { type: 'response.output_text.delta', item_id: 'message', delta: 'い' },
    { type: 'response.completed', response: { ...result, output: [reasoning, message] } },
  ]
  const stream = new TextEncoder().encode(events.map((e) => 'data: ' + JSON.stringify(e) + '\r\n\r\n').join(''))
  const seen: string[] = []
  const llm = createResponsesLLM({
    model: 'model',
    provider: 'p',
    send: async (_body, consume) => {
      for (let i = 0; i < stream.length; i += 3) await consume(stream.subarray(i, i + 3))
    },
  })
  const response = await llm.createResponse(
    { input: [] },
    {
      ...createVoiceScope(),
      onEvent: async (e) => {
        await Promise.resolve()
        assert.equal(e.type === 'response.output_text.delta' && e.phase, 'final_answer')
        seen.push(e.delta)
      },
    },
  )
  assert.deepEqual(seen, ['は', 'い'])
  assert.deepEqual(response.output[1], message)
  assert.equal(outputText({ ...response, output: [{ ...message, phase: 'commentary' }, ...response.output] }), 'はい')
  const replay = prepareBody({ input: response.output }, 'model', 'p', 4096)
  assert.deepEqual(JSON.parse(Buffer.concat([...replay.read()]).toString()).input, [reasoning, message])
  assert.throws(() => prepareBody({ input: response.output }, 'model', 'other', 4096), /incompatible provider/)
})

test('Agent records an already executed tool when barge-in aborts before the next model request', async () => {
  const scope = createVoiceScope()
  let count = 0
  const tools = createToolSet([
    {
      ...tool,
      execute() {
        count++
        scope.abort()
        return 'moved'
      },
    },
  ])
  const llm: LLM = {
    capabilities: { tools: true, image: true },
    async createResponse() {
      return { ...result, output: [call] }
    },
  }
  const agent = createAgent({ llm, tools, instructions: '', maxToolRounds: 2 })
  const response = await agent.run({ input: [], sessionId: 's', turnId: 't' }, scope)
  assert.equal(response.status, 'cancelled')
  assert.deepEqual(response.appended, [call, { type: 'function_call_output', call_id: 'call', output: 'moved' }])
  assert.equal(count, 1)
  assert.equal(
    (await tools.execute(call, { sessionId: 's', turnId: 't', callId: 'call', ...createVoiceScope() })).output,
    'moved',
  )
  assert.equal(count, 1)
})

test('incomplete tool call never moves the head; validated tool calls continue with original item order', async () => {
  const requests: (readonly InputItem[])[] = []
  let incomplete = true,
    count = 0
  const llm: LLM = {
    capabilities: { tools: true, image: true },
    async createResponse(req) {
      requests.push(req.input)
      if (req.input.length) assert.equal(req.tool_choice, 'none')
      return req.input.length ? result : { ...result, status: incomplete ? 'incomplete' : 'completed', output: [call] }
    },
  }
  const tools = createToolSet([
    {
      ...tool,
      execute() {
        count++
        return 'moved'
      },
    },
  ])
  const agent = createAgent({ llm, tools, instructions: '', maxToolRounds: 1 })
  const req = { input: [], sessionId: 's', turnId: 't' }
  assert.equal((await agent.run(req, createVoiceScope())).status, 'incomplete')
  assert.equal(count, 0)
  incomplete = false
  assert.equal((await agent.run(req, createVoiceScope())).status, 'completed')
  assert.equal(count, 1)
  assert.deepEqual(requests[2], [call, { type: 'function_call_output', call_id: 'call', output: 'moved' }])
  await assert.rejects(
    tools.execute(
      { ...call, call_id: 'bad', arguments: '{"angle":"x"}' },
      { ...createVoiceScope(), callId: 'bad', turnId: 't', sessionId: 's' },
    ),
  )
  assert.equal(count, 1)
})

test('client delegation returns the completed final answer and waits for running effects before releasing the journal', async () => {
  let status: ModelResponse['status'] = 'completed'
  const llm: LLM = {
    capabilities: { image: true, tools: true },
    async createResponse() {
      return {
        ...result,
        status,
        output: [
          { type: 'provider_item', provider: 'test', id: 'private', value: { encrypted_content: 'sealed' } },
          { ...message, phase: 'commentary' },
          message,
        ],
      }
    },
  }
  const agent = createAgent({ llm, tools: createToolSet(), instructions: '', maxToolRounds: 1 })
  const delegate = asDelegateAgent(agent)
  const request = { input: [], sessionId: 's', turnId: 't', delegationId: 'd' }
  assert.deepEqual(await delegate.run(request, createVoiceScope()), [message])
  status = 'incomplete'
  await assert.rejects(delegate.run(request, createVoiceScope()), { code: 'provider_failed' })

  let settle!: () => void
  const wait = new Promise<void>((resolve) => {
    settle = resolve
  })
  const released: string[] = []
  const scope = createVoiceScope()
  const slow = asDelegateAgent({
    async run(received, options) {
      assert.equal(received, request)
      assert.equal(options.signal, scope.signal)
      await wait
      return { status: 'completed', response: result, appended: [message] }
    },
    releaseSession(id) {
      released.push(id)
    },
  })
  const pending = slow.run(request, scope)
  scope.abort()
  slow.releaseSession?.('s')
  assert.deepEqual(released, [])
  settle()
  await assert.rejects(pending, { code: 'cancelled' })
  assert.deepEqual(released, ['s'])
})

test('Vision releases the borrowed frame after success and a provider error', async () => {
  let releases = 0,
    calls = 0
  const image = { format: 'png' as const, data: Uint8Array.of(1) }
  const camera = {
    async capture() {
      return {
        image,
        capturedAtMs: 100,
        release() {
          releases++
        },
      }
    },
  }
  const llm: LLM = {
    capabilities: { image: true, tools: false },
    async createResponse(request) {
      assert.deepEqual(request.input, [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: '色は？' },
            { type: 'input_image', image },
          ],
        },
      ])
      assert.equal(calls, releases)
      if (++calls === 2) throw Error('network')
      return result
    },
  }
  const vision = createVision({ camera, llm })
  assert.deepEqual(await vision.observe({ question: '色は？' }, createVoiceScope()), {
    text: 'はい',
    capturedAtMs: 100,
  })
  await assert.rejects(vision.observe({ question: '色は？' }, createVoiceScope()), /network/)
  assert.equal(releases, 2)
})

function httpFixture(maxBytes: number) {
  let handlers!: Parameters<ResponseConnection['request']>[0]
  let disconnect!: (error?: unknown) => void
  let closes = 0
  const transport = streamResponse(
    {
      path: '/v1/responses',
      connect(onError) {
        disconnect = onError
        return {
          request(options) {
            handlers = options
          },
          close() {
            closes++
          },
        }
      },
      schedule: (callback, ms) => setTimeout(callback, ms),
      clear: (handle) => clearTimeout(handle),
    },
    '',
    5000,
    maxBytes,
  )
  return {
    transport,
    disconnect(error?: unknown) {
      disconnect(error)
    },
    get handlers() {
      return handlers
    },
    get closes() {
      return closes
    },
  }
}

test('Responses drains final SSE on socket close and rejects a stream containing only deltas', async () => {
  for (const withFinal of [false, true]) {
    const io = httpFixture(2048)
    const model = createResponsesLLM({ model: 'test', provider: 'test', send: io.transport })
    const pending = model.createResponse({ input: [] }, createVoiceScope())
    const events: object[] = [{ type: 'response.output_text.delta', item_id: 'message', delta: 'はい' }]
    if (withFinal) events.push({ type: 'response.completed', response: result })
    const bytes = ArrayBuffer.fromString(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''))
    io.handlers.onHeaders(200)
    io.handlers.onReadable.call({ read: () => bytes, write: () => 0 }, bytes.byteLength)
    io.handlers.onDone(new Error())
    io.disconnect(new Error('socket reset'))
    if (withFinal) assert.equal((await pending).status, 'completed')
    else await assert.rejects(pending, /socket reset/)
    assert.equal(io.closes, 1)
  }
})

test('HTTP drains accepted response callbacks and honors each writable credit returned by the socket', async () => {
  const io = httpFixture(1024)
  const uploaded: number[] = []
  const body = {
    length: 5,
    *read() {
      yield Uint8Array.of(1, 2, 3)
      yield Uint8Array.of(4, 5)
    },
  }
  const received: number[] = []
  const task = io.transport(
    body,
    async (chunk) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 5))
      received.push(...chunk)
    },
    createVoiceScope(),
  )
  const writer = {
    write(data: Uint8Array) {
      uploaded.push(...data)
      return 0
    },
    read() {
      return Uint8Array.of(9, 8).buffer
    },
  }
  io.handlers.onWritable.call(writer, 4)
  assert.deepEqual(uploaded, [1, 2, 3])
  io.handlers.onWritable.call(writer, 4)
  assert.deepEqual(uploaded, [1, 2, 3, 4, 5])
  assert.equal(io.handlers.headers.get('content-length'), '5')
  io.handlers.onHeaders(200)
  io.handlers.onReadable.call(writer, 2)
  io.handlers.onDone()
  await task
  assert.deepEqual(received, [9, 8])
  assert.equal(io.closes, 1)
})

test('HTTP abort and input overflow close once and stop reading the camera buffer', async () => {
  for (const abort of [false, true]) {
    const io = httpFixture(4)
    const scope = createVoiceScope()
    let reads = 0
    const task = io.transport(
      {
        length: 1,
        *read() {
          reads++
          yield Uint8Array.of(1)
        },
      },
      async () => {},
      scope,
    )
    const source = {
      write() {
        return 0
      },
      read() {
        return new ArrayBuffer(8)
      },
    }
    if (abort) scope.abort()
    else io.handlers.onReadable.call(source, 8)
    io.handlers.onWritable.call(source, 10)
    io.handlers.onDone()
    await assert.rejects(task, { code: abort ? 'cancelled' : 'resource_exhausted' })
    assert.equal(io.closes, 1)
    assert.equal(reads, 0)
  }
})
test('Chat Completions streams a tool call and replays Gemini signature with its result', async () => {
  const payloads: Record<string, unknown>[][] = []
  const llm = createChatLLM({
    model: 'model',
    provider: 'gemini',
    send: async (body, consume) => {
      payloads.push(JSON.parse(Buffer.concat([...body.read()]).toString()).messages)
      const frames =
        payloads.length === 1
          ? [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call',
                      type: 'function',
                      function: { name: 'move', arguments: '{"angle":' },
                      extra_content: { google: { thought_signature: 'sig' } },
                    },
                  ],
                },
              },
              { delta: { tool_calls: [{ index: 0, function: { arguments: '10}' } }] }, finish_reason: 'tool_calls' },
            ]
          : [{ delta: { content: 'はい' }, finish_reason: 'stop' }]
      for (const choice of frames)
        await consume(new TextEncoder().encode('data: ' + JSON.stringify({ id: 'r', choices: [choice] }) + '\n\n'))
    },
  })
  const agent = createAgent({ llm, tools: createToolSet([tool]), instructions: 'instruction', maxToolRounds: 1 })
  const run = await agent.run(
    {
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'こんにちは' }] }],
      turnId: '1',
      sessionId: 's',
    },
    createVoiceScope(),
  )
  assert.equal(run.status, 'completed')
  assert.deepEqual(payloads[1], [
    { role: 'system', content: 'instruction' },
    { role: 'user', content: [{ type: 'text', text: 'こんにちは' }] },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call',
          type: 'function',
          function: { name: 'move', arguments: '{"angle":10}' },
          extra_content: { google: { thought_signature: 'sig' } },
        },
      ],
    },
    { role: 'tool', tool_call_id: 'call', content: 'moved' },
  ])
})
