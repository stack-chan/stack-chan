// Copyright (c) 2026 Shinya Ishikawa
// SPDX-License-Identifier: Apache-2.0

/*---
description: Live WebRTC protocol, command correlation, and cleanup races
flags: [module]
---*/
import Conversation from '../core.js'

Object.freeze(Error.prototype)

function check(value, message = 'assertion failed') {
  if (!value) throw new Error(message)
}
function equal(a, b) {
  check(JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} != ${JSON.stringify(b)}`)
}
async function rejected(promise, code) {
  try {
    await promise
  } catch (error) {
    equal(error.code, code)
    return
  }
  throw new Error(`expected rejection: ${code}`)
}
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}
function harness(options = {}) {
  let callback,
    requests = [],
    sent = [],
    timers = new Map(),
    id = 0,
    disposed = 0,
    localMute = false
  let reply = async () => ({
    status: 201,
    ok: true,
    text: async () =>
      JSON.stringify({ session: { id: 'live_opaque' }, transport: { type: 'webrtc', sdp: 'v=0\r\nanswer' } }),
  })
  const events = [],
    transcripts = [],
    errors = [],
    states = []
  const c = new Conversation(
    {
      apiKey: 'test-key',
      onEvent: (e) => events.push(e),
      onTranscript: (e) => transcripts.push(e),
      onError: (e) => errors.push(e),
      onStateChanged: (e) => states.push(e),
      ...options,
    },
    {
      createTransport(cb) {
        callback = cb
        return {
          start() {},
          setVolume() {},
          setMuted(v) {
            localMute = v
          },
          acceptAnswer(sdp) {
            equal(sdp, 'v=0\r\nanswer')
          },
          send(text) {
            sent.push(JSON.parse(text))
          },
          async close() {
            disposed++
          },
        }
      },
      fetch(url, init) {
        requests.push({ url, init })
        return reply(url, init)
      },
      setTimeout(cb, delay) {
        const key = ++id
        timers.set(key, { cb, delay })
        return key
      },
      clearTimeout(key) {
        timers.delete(key)
      },
    },
  )
  return {
    c,
    requests,
    sent,
    events,
    transcripts,
    errors,
    states,
    get disposed() {
      return disposed
    },
    get localMute() {
      return localMute
    },
    reply(fn) {
      reply = fn
    },
    emit(event) {
      callback(event)
    },
    message(event) {
      callback({ type: 'message', data: JSON.stringify(event) })
    },
    timeout(delay) {
      for (const [key, timer] of timers)
        if (timer.delay === delay) {
          timers.delete(key)
          timer.cb()
          break
        }
    },
    async signal() {
      callback({ type: 'offer', sdp: 'v=0\r\noffer' })
      await flush()
    },
    async connect() {
      const p = c.connect()
      await this.signal()
      this.message({ type: 'session.started', session: { id: 'live_opaque' } })
      await p
    },
  }
}
let count = 0
async function test(name, run) {
  await run()
  count++
  console.log(`PASS ${name}`)
}
await test('Live session JSON and no session.start on WebRTC', async () => {
  const h = harness()
  await h.connect()
  const request = h.requests[0]
  equal(request.url, 'https://api.openai.com/v1/live/sessions')
  const body = JSON.parse(request.init.body)
  equal(body.session.model, 'gpt-live-1')
  equal(body.session.audio.output.voice, 'marin')
  equal(body.session.delegation.responses.tools, [{ type: 'web_search' }])
  equal(body.transport.type, 'webrtc')
  equal(h.sent, [])
  const p = h.c.close()
  equal(h.sent, [{ type: 'session.close' }])
  h.message({ type: 'session.closed', reason: 'client_request', usage: { seconds: 3 } })
  equal(await p, { finalized: true, reason: 'client_request', usage: { seconds: 3 } })
  equal(h.disposed, 1)
})
await test('preserve overlapping transcript fragments and cumulative usage', async () => {
  const h = harness()
  await h.connect()
  h.message({ type: 'session.input_transcript.delta', delta: ' 東京', start_ms: 10, end_ms: 40 })
  h.message({ type: 'session.output_transcript.delta', delta: 'はい', start_ms: 20, end_ms: 30 })
  equal(h.transcripts[0], { role: 'user', delta: ' 東京', start_ms: 10, end_ms: 40 })
  equal(h.transcripts[1].role, 'assistant')
  h.message({ type: 'session.usage.updated', usage: { seconds: 8 } })
  h.message({ type: 'session.usage.updated', usage: { seconds: 9 } })
  equal(h.c.usage.seconds, 9)
  const usage = h.c.usage
  usage.seconds = 99
  equal(h.c.usage.seconds, 9)
  h.message({ type: 'response.event', event: { type: 'response.completed' } })
  equal(h.events.at(-1).type, 'response.event')
})
await test('mute acknowledgments must match the command', async () => {
  const h = harness()
  await h.connect()
  let resolved = false
  const p = h.c.setMuted(true).then(() => {
    resolved = true
  })
  check(h.localMute)
  h.message({ type: 'session.input_audio.muted', client_event_id: 'wrong' })
  await flush()
  check(!resolved)
  h.message({ type: 'session.input_audio.muted', client_event_id: h.sent.at(-1).event_id })
  await p
  const unmute = h.c.setMuted(false)
  check(h.localMute)
  h.message({ type: 'session.input_audio.unmuted', client_event_id: h.sent.at(-1).event_id })
  await unmute
  check(!h.localMute)
})
await test('unmute timeout keeps microphone locally muted', async () => {
  const h = harness()
  await h.connect()
  let p = h.c.setMuted(true)
  h.message({ type: 'session.input_audio.muted', client_event_id: h.sent.at(-1).event_id })
  await p
  p = h.c.setMuted(false)
  const failure = rejected(p, 'command_timeout')
  h.timeout(5000)
  await failure
  check(h.localMute && h.c.muted)
})
await test('concurrent mute commands are rejected', async () => {
  const h = harness()
  await h.connect()
  const p = h.c.setMuted(true)
  await rejected(h.c.setMuted(false), 'command_pending')
  h.message({ type: 'session.input_audio.muted', client_event_id: h.sent.at(-1).event_id })
  await p
})
await test('close before an offer avoids creating a session', async () => {
  const h = harness()
  const p = rejected(h.c.connect(), 'cancelled')
  const closing = h.c.close()
  check(closing === h.c.close())
  await p
  equal((await closing).reason, 'not_started')
  equal(h.requests.length, 0)
  equal(h.disposed, 1)
})
await test('close during HTTP waits for startup then sends close', async () => {
  const h = harness()
  let resolve
  h.reply(
    () =>
      new Promise((r) => {
        resolve = r
      }),
  )
  const p = rejected(h.c.connect(), 'cancelled')
  await h.signal()
  const closing = h.c.close()
  await p
  resolve({
    status: 201,
    text: async () =>
      JSON.stringify({ session: { id: 'live_opaque' }, transport: { type: 'webrtc', sdp: 'v=0\r\nanswer' } }),
  })
  await flush()
  equal(h.sent.length, 0)
  h.message({ type: 'session.started', session: { id: 'live_opaque' } })
  equal(h.sent, [{ type: 'session.close' }])
  h.message({ type: 'session.closed', reason: 'client_request' })
  check((await closing).finalized)
})
await test('late HTTP answer after timeout triggers bodyless hangup', async () => {
  const h = harness()
  let resolve
  h.reply(
    () =>
      new Promise((r) => {
        resolve = r
      }),
  )
  const p = rejected(h.c.connect(), 'cancelled')
  await h.signal()
  const closing = h.c.close()
  await p
  h.timeout(15000)
  check(!(await closing).finalized)
  equal(h.disposed, 1)
  h.reply(async () => ({ ok: true, text: async () => '' }))
  resolve({
    status: 201,
    text: async () =>
      JSON.stringify({ session: { id: 'live_opaque' }, transport: { type: 'webrtc', sdp: 'v=0\r\nanswer' } }),
  })
  await flush()
  equal(h.requests[1].url, 'https://api.openai.com/v1/live/sessions/live_opaque/hangup')
  equal(h.requests[1].init.body, '')
})
await test('HTTP rejection preserves status and cleans up', async () => {
  const h = harness()
  h.reply(async () => ({ status: 401, text: async () => 'private server details' }))
  const p = rejected(h.c.connect(), 'http_error')
  await h.signal()
  await p
  await flush()
  equal(h.errors[0].status, 401)
  check(!h.errors[0].message.includes('private'))
  equal(h.disposed, 1)
  equal(h.c.state, 'error')
})
await test('invalid JSON and mismatched sessions cannot start', async () => {
  const h = harness()
  const p = rejected(h.c.connect(), 'session_mismatch')
  await h.signal()
  h.message({ type: 'session.started', session: { id: 'wrong' } })
  await p
  await flush()
  equal(h.disposed, 1)
  const j = harness()
  await j.connect()
  j.emit({ type: 'message', data: '{' })
  await flush()
  equal(j.errors[0].code, 'invalid_json')
  equal(j.disposed, 1)
})
await test('unexpected disconnect is not confirmed finalization', async () => {
  const h = harness()
  await h.connect()
  h.emit({ type: 'disconnected' })
  await flush()
  const result = await h.c.close()
  check(!result.finalized)
  equal(result.reason, 'connection_lost')
  equal(h.disposed, 1)
})
await test('server-initiated close and duplicate events clean up once', async () => {
  const h = harness()
  await h.connect()
  h.message({ type: 'session.closed', reason: 'maximum_duration', usage: { seconds: 60 } })
  h.message({ type: 'session.closed', reason: 'maximum_duration' })
  await flush()
  check((await h.c.close()).finalized)
  equal(h.disposed, 1)
  equal(h.c.usage.seconds, 60)
})
await test('reentrant close from connecting callback does not start native', async () => {
  let h
  h = harness({
    onStateChanged(s) {
      if (s === 'connecting') void h.c.close()
    },
  })
  await rejected(h.c.connect(), 'cancelled')
  await flush()
  equal(h.disposed, 0)
  equal(h.c.state, 'closed')
})
const emptySchema = { type: 'object', properties: {}, additionalProperties: false }
function response(h, type, extra = {}, delegation = 'delegation_1') {
  h.message({ type: 'response.event', delegation_id: delegation, event: { type, ...extra } })
}
function created(h, id = 'response_1', delegation) {
  response(h, 'response.created', { response: { id, output: [] } }, delegation)
}
function call(h, id, name, args = '{}') {
  response(h, 'response.output_item.done', { item: { type: 'function_call', call_id: id, name, arguments: args } })
}
function completed(h, id = 'response_1') {
  response(h, 'response.completed', { response: { id, output: [] } })
}
await test('registered tools reach session without executable code', async () => {
  const h = harness({
    tools: [
      {
        name: 'status',
        parameters: emptySchema,
        execute() {
          return { ok: true }
        },
      },
    ],
  })
  await h.connect()
  const tools = JSON.parse(h.requests[0].init.body).session.delegation.responses.tools
  equal(tools[0].type, 'web_search')
  equal(tools[1].name, 'status')
  check(!('execute' in tools[1]))
})
await test('collect completed items, execute once, submit all before continuing', async () => {
  let resolve,
    executions = 0
  const results = []
  const h = harness({
    tools: [
      {
        name: 'status',
        parameters: emptySchema,
        execute(args) {
          executions++
          return args.slow
            ? new Promise((r) => {
                resolve = r
              })
            : { ok: true }
        },
      },
    ],
    onToolResult: (value) => results.push(value),
  })
  await h.connect()
  created(h)
  response(h, 'response.function_call_arguments.done', { arguments: '{}' })
  call(h, 'call1', 'status')
  call(h, 'call1', 'status')
  call(h, 'call2', 'status', '{"slow":true}')
  await flush()
  equal(executions, 0)
  completed(h)
  completed(h)
  await flush()
  equal(executions, 2)
  equal(h.sent.length, 0)
  resolve('ready')
  await flush()
  equal(
    h.sent.map((e) => e.type),
    ['response.item.create', 'response.item.create', 'response.create'],
  )
  equal(h.sent[0].item.call_id, 'call1')
  equal(h.sent[1].item.output, 'ready')
  equal(results.length, 2)
  check(!('delegation_id' in h.sent[2]))
  created(h, 'response_2')
  call(h, 'call1', 'status')
  completed(h, 'response_2')
  await flush()
  equal(executions, 2)
})
await test('tool errors return bounded structured failures without leaking exceptions', async () => {
  const h = harness({
    tools: [
      {
        name: 'broken',
        parameters: emptySchema,
        execute() {
          throw new Error('SECRET')
        },
      },
      {
        name: 'large',
        parameters: emptySchema,
        execute() {
          return 'x'.repeat(8193)
        },
      },
    ],
  })
  await h.connect()
  created(h)
  call(h, 'unknown', 'missing')
  call(h, 'badjson', 'broken', '{')
  call(h, 'throw', 'broken')
  call(h, 'big', 'large')
  completed(h)
  await flush()
  equal(
    h.sent.slice(0, 4).map((e) => JSON.parse(e.item.output).error),
    ['unknown_tool', 'invalid_arguments', 'tool_execution_failed', 'invalid_tool_output'],
  )
  check(!JSON.stringify(h.sent).includes('SECRET'))
  equal(h.sent.at(-1).type, 'response.create')
})
await test('tool timeout completes once and rejects late results', async () => {
  let resolve, context
  const h = harness({
    tools: [
      {
        name: 'slow',
        parameters: emptySchema,
        execute(_args, ctx) {
          context = ctx
          return new Promise((r) => {
            resolve = r
          })
        },
      },
    ],
    toolTimeout: 1234,
  })
  await h.connect()
  created(h)
  call(h, 'slow1', 'slow')
  completed(h)
  await flush()
  h.timeout(1234)
  await flush()
  check(context.isCancelled())
  equal(JSON.parse(h.sent[0].item.output).error, 'tool_timeout')
  resolve('late')
  await flush()
  equal(h.sent.length, 2)
})
await test('closing cancels pending tools and sends no late results', async () => {
  let resolve, context
  const h = harness({
    tools: [
      {
        name: 'slow',
        parameters: emptySchema,
        execute(_args, ctx) {
          context = ctx
          return new Promise((r) => {
            resolve = r
          })
        },
      },
    ],
  })
  await h.connect()
  created(h)
  call(h, 'slow1', 'slow')
  completed(h)
  await flush()
  const p = h.c.close()
  check(context.isCancelled())
  h.message({ type: 'session.closed', reason: 'close_requested' })
  await p
  resolve('late')
  await flush()
  equal(h.sent, [{ type: 'session.close' }])
})
await test('failed, incomplete, and cancelled responses never execute collected tools', async () => {
  for (const terminal of ['response.failed', 'response.incomplete', 'response.cancelled']) {
    let executions = 0
    const h = harness({
      tools: [
        {
          name: 'status',
          parameters: emptySchema,
          execute() {
            executions++
          },
        },
      ],
    })
    await h.connect()
    created(h)
    call(h, 'call1', 'status')
    response(h, terminal, { response: { id: 'response_1' } })
    completed(h)
    await flush()
    equal(executions, 0)
  }
})
await test('response cancellation discards results while a handler is running', async () => {
  let resolve, context
  const h = harness({
    tools: [
      {
        name: 'slow',
        parameters: emptySchema,
        execute(_args, ctx) {
          context = ctx
          return new Promise((r) => {
            resolve = r
          })
        },
      },
    ],
  })
  await h.connect()
  created(h)
  call(h, 'slow1', 'slow')
  completed(h)
  await flush()
  response(h, 'response.cancelled', { response: { id: 'response_1' } })
  check(context.isCancelled())
  resolve('late')
  await flush()
  equal(h.sent, [])
})
await test('close from a result callback stops the rest of the batch', async () => {
  let h
  h = harness({
    tools: [
      {
        name: 'status',
        parameters: emptySchema,
        execute() {
          return 'ok'
        },
      },
    ],
    onToolResult() {
      void h.c.close()
    },
  })
  await h.connect()
  created(h)
  call(h, 'call1', 'status')
  call(h, 'call2', 'status')
  completed(h)
  await flush()
  equal(
    h.sent.map((event) => event.type),
    ['response.item.create', 'session.close'],
  )
  h.message({ type: 'session.closed', reason: 'close_requested' })
  await h.c.close()
})
const brokerOptions = {
  apiKey: undefined,
  broker: { url: 'https://broker.example:8443', deviceToken: `device_${'a'.repeat(36)}` },
}
const tokenValue = 't'.repeat(43),
  controlValue = 'c'.repeat(43)
const tokenReply = () => ({
  status: 200,
  ok: true,
  text: async () => JSON.stringify({ value: tokenValue, expires_at: Date.now() / 1000 + 60 }),
})
const brokerReply = () => ({
  status: 201,
  ok: true,
  text: async () =>
    JSON.stringify({
      session: { id: 'live_opaque' },
      transport: { type: 'webrtc', sdp: 'v=0\r\nanswer' },
      broker: { control_token: controlValue },
    }),
})
await test('broker obtains a one-use token and sends only SDP to the trusted server', async () => {
  const h = harness(brokerOptions)
  h.reply(async (url) =>
    url.endsWith('/token')
      ? tokenReply()
      : url.endsWith('/hangup')
        ? { ok: true, text: async () => '' }
        : brokerReply(),
  )
  await h.connect()
  equal(h.requests.length, 2)
  equal(h.requests[0].url, 'https://broker.example:8443/token')
  equal(h.requests[0].init.headers.Authorization, `Bearer ${brokerOptions.broker.deviceToken}`)
  equal(h.requests[1].init.headers.Authorization, `Bearer ${tokenValue}`)
  equal(JSON.parse(h.requests[1].init.body), { transport: { type: 'webrtc', sdp: 'v=0\r\noffer' } })
  const p = h.c.close()
  h.message({ type: 'session.closed', reason: 'close_requested' })
  await p
  await flush()
  equal(h.requests[2].url, 'https://broker.example:8443/sessions/live_opaque/hangup')
  equal(h.requests[2].init.headers.Authorization, `Bearer ${controlValue}`)
  check(h.requests.every((r) => !r.url.includes('api.openai.com')))
})
await test('expired broker credentials fail without direct-key fallback', async () => {
  const h = harness(brokerOptions)
  h.reply(async () => ({ status: 200, text: async () => JSON.stringify({ value: tokenValue, expires_at: 1 }) }))
  const p = rejected(h.c.connect(), 'operation_failed')
  await h.signal()
  await p
  await flush()
  equal(h.requests.length, 1)
  equal(h.disposed, 1)
})
await test('close while minting a token never starts a paid session', async () => {
  const h = harness(brokerOptions)
  let resolve
  h.reply(
    () =>
      new Promise((r) => {
        resolve = r
      }),
  )
  const p = rejected(h.c.connect(), 'cancelled')
  await h.signal()
  const result = await h.c.close()
  await p
  equal(result.reason, 'not_started')
  resolve(tokenReply())
  await flush()
  equal(h.requests.length, 1)
})
await test('late broker session creation is cleaned up with its scoped control token', async () => {
  const h = harness(brokerOptions)
  let resolve
  h.reply(async (url) =>
    url.endsWith('/token')
      ? tokenReply()
      : new Promise((r) => {
          resolve = r
        }),
  )
  const p = rejected(h.c.connect(), 'cancelled')
  await h.signal()
  const closing = h.c.close()
  await p
  h.timeout(15000)
  check(!(await closing).finalized)
  h.reply(async () => ({ ok: true, text: async () => '' }))
  resolve(brokerReply())
  await flush()
  equal(h.requests[2].init.headers.Authorization, `Bearer ${controlValue}`)
  equal(h.requests[2].url, 'https://broker.example:8443/sessions/live_opaque/hangup')
})
await test('injected signaling can install tools before issuing a session', async () => {
  let h,
    started = 0,
    accepted = 0,
    ended = 0
  h = harness({
    apiKey: undefined,
    signaling: {
      async createSession({ sdp, canStart, starting }) {
        equal(sdp, 'v=0\r\noffer')
        check(canStart())
        h.c.setTools([
          {
            name: 'status',
            parameters: { type: 'object' },
            execute() {
              return { ok: true }
            },
          },
        ])
        starting()
        started++
        return brokerReply()
      },
      acceptSession(result) {
        equal(result.session.id, 'live_opaque')
        accepted++
      },
      async hangup({ sessionId }) {
        equal(sessionId, 'live_opaque')
        ended++
      },
    },
  })
  await h.connect()
  equal(started, 1)
  equal(accepted, 1)
  equal(h.requests.length, 0)
  let refused = false
  try {
    h.c.setTools([])
  } catch {
    refused = true
  }
  check(refused)
  const closing = h.c.close()
  h.message({ type: 'session.closed', usage: { seconds: 1 } })
  await closing
  equal(ended, 1)
})
await test('injected signaling honors cancellation before starting paid creation', async () => {
  let resume,
    started = 0
  const h = harness({
    apiKey: undefined,
    signaling: {
      async createSession({ canStart, starting }) {
        await new Promise((resolve) => {
          resume = resolve
        })
        if (!canStart()) return
        starting()
        started++
        return brokerReply()
      },
      async hangup() {},
    },
  })
  const connection = rejected(h.c.connect(), 'cancelled')
  await h.signal()
  await h.c.close()
  await connection
  resume()
  await flush()
  equal(started, 0)
})
console.log(`${count} tests passed`)
