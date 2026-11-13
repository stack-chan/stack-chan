import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { beforeEach, test } from 'node:test'
import Timer from '../../testing/fakes/timer.js'
import { createVoiceScope } from '../scope.js'

ArrayBuffer.fromString = (value) => new TextEncoder().encode(value).buffer
const aliases: Record<string, string> = {
  headers: 'data:text/javascript,export default globalThis.Headers',
  'stt-whisper': 'data:text/javascript,export default class {}',
  timer: '../../testing/fakes/timer.js',
  'stackchan/voice/media': '../media.js',
  'stackchan/voice/pcm-http': '../pcm-http.js',
  'stackchan/voice/scope': '../scope.js',
  'realtimeConversation/http-core': '../../../../../host/modules/realtime-conversation/http-core.js',
}
const hooks = registerHooks({
  resolve(specifier, context, next) {
    return aliases[specifier]
      ? { shortCircuit: true, url: new URL(aliases[specifier], import.meta.url).href }
      : next(specifier, context)
  },
})
const { OpenAISpeechTTS } = await import('../speech.js')
const { mono, readSource, subscribePcmSource } = await import('../media.js')
hooks.deregister()

type Lookup = { onResolved(host: string, address: string): void; onError(error: Error): void }
class DNS {
  static pending: Lookup[] = []
  resolve(lookup: Lookup) {
    DNS.pending.push(lookup)
  }
}

type Request = {
  onHeaders(status: number): void
  onReadable(this: HTTP, count: number): void
  onWritable(this: HTTP, count: number): void
  onDone(error?: Error): void
}
class HTTP {
  static clients: HTTP[] = []
  static activeSockets = 0
  connected = false
  closed = 0
  requestOptions!: Request
  pcm: Uint8Array = new Uint8Array(0)
  sent = ''
  constructor(options: { dns: { io: typeof DNS }; onError(error: Error): void }) {
    HTTP.clients.push(this)
    new options.dns.io().resolve({
      onResolved: () => {
        this.connected = true
        HTTP.activeSockets++
      },
      onError: options.onError,
    })
  }
  request(options: Request) {
    this.requestOptions = options
  }
  write(bytes: DataView) {
    this.sent += new TextDecoder().decode(bytes)
    return 0
  }
  read(target: Uint8Array) {
    const count = Math.min(target.length, this.pcm.length)
    target.set(this.pcm.subarray(0, count))
    this.pcm = this.pcm.subarray(count)
    return count
  }
  respond(pcm: Uint8Array) {
    assert.equal(this.connected, true)
    this.pcm = pcm
    this.requestOptions.onWritable.call(this, 4096)
    this.requestOptions.onHeaders(200)
    this.requestOptions.onReadable.call(this, pcm.length)
    this.requestOptions.onDone()
  }
  close() {
    this.closed++
    if (this.connected) {
      this.connected = false
      HTTP.activeSockets--
    }
  }
}

test('speech flush is reusable, seals only at endInput and preserves bounded segment order', async () => {
  const provider = OpenAISpeechTTS.create({ apiKey: 'test' })
  assert.deepEqual(provider.capabilities, { input: 'segmented', output: 'streaming' })
  const synthesis = await provider.open({ ...createVoiceScope(), format: mono(24000), voice: 'alloy' })
  const heard: number[] = []
  let ended = false
  subscribePcmSource(synthesis.output, {
    write(bytes) {
      heard.push(...bytes)
    },
    end(error) {
      assert.equal(error, undefined)
      ended = true
    },
  })
  await synthesis.write('one')
  const first = synthesis.flush()
  await synthesis.write('two')
  await assert.rejects(synthesis.flush(), { code: 'device_busy' })
  await assert.rejects(synthesis.write('x'.repeat(4096)), { code: 'resource_exhausted' })
  DNS.pending[0].onResolved('api.openai.com', '127.0.0.1')
  HTTP.clients[0].respond(Uint8Array.of(1, 0))
  await first
  assert.equal(ended, false)
  const second = synthesis.flush()
  DNS.pending[1].onResolved('api.openai.com', '127.0.0.1')
  HTTP.clients[1].respond(Uint8Array.of(2, 0))
  await second
  assert.equal(ended, false)
  await synthesis.write('tail')
  const end = synthesis.endInput()
  assert.equal(synthesis.endInput(), end)
  await assert.rejects(synthesis.write('late'), { code: 'cancelled' })
  await assert.rejects(synthesis.flush(), { code: 'cancelled' })
  DNS.pending[2].onResolved('api.openai.com', '127.0.0.1')
  HTTP.clients[2].respond(Uint8Array.of(3, 0))
  await end
  assert.equal(ended, true)
  assert.deepEqual(heard, [1, 0, 2, 0, 3, 0])
  assert.deepEqual(
    HTTP.clients.map((client) => JSON.parse(client.sent).input),
    ['one', 'two', 'tail'],
  )
  await synthesis.close()
})

test('speech endInput waits for the active flush before synthesizing its tail', async () => {
  const synthesis = await OpenAISpeechTTS.create({ apiKey: 'test' }).open({
    ...createVoiceScope(),
    format: mono(24000),
    voice: 'alloy',
  })
  await synthesis.write('first')
  const flushed = synthesis.flush()
  await synthesis.write('tail')
  const ended = synthesis.endInput()
  assert.equal(HTTP.clients.length, 1)
  DNS.pending[0].onResolved('api.openai.com', '127.0.0.1')
  HTTP.clients[0].respond(Uint8Array.of(1, 0))
  await flushed
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(HTTP.clients.length, 2)
  DNS.pending[1].onResolved('api.openai.com', '127.0.0.1')
  HTTP.clients[1].respond(Uint8Array.of(2, 0))
  await ended
  await synthesis.close()
})

test('speech flush waits for consumer release; close aborts the pending operation and rejects later input', async () => {
  const synthesis = await OpenAISpeechTTS.create({ apiKey: 'test' }).open({
    ...createVoiceScope(),
    format: mono(24000),
    voice: 'alloy',
  })
  let release!: () => void
  let delivered = false
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  readSource(synthesis.output, () => pending)
  await synthesis.write('one')
  const flush = synthesis.flush().then(() => {
    delivered = true
  })
  const rejected = assert.rejects(flush, { code: 'cancelled' })
  DNS.pending[0].onResolved('api.openai.com', '127.0.0.1')
  HTTP.clients[0].respond(Uint8Array.of(1, 0))
  await Promise.resolve()
  assert.equal(delivered, false)
  await synthesis.close()
  await rejected
  await synthesis.close()
  release()
  await assert.rejects(synthesis.write('late'), { code: 'cancelled' })
  await assert.rejects(synthesis.endInput(), { code: 'cancelled' })
  assert.equal(HTTP.activeSockets, 0)
})

test('empty speech closes without issuing HTTP, and failed flush cannot silently drop its segment', async () => {
  const provider = OpenAISpeechTTS.create({ apiKey: 'test' })
  const empty = await provider.open({ ...createVoiceScope(), format: mono(24000), voice: 'alloy' })
  await empty.flush()
  await empty.endInput()
  assert.equal(HTTP.clients.length, 0)
  const broken = await provider.open({ ...createVoiceScope(), format: mono(24000), voice: 'alloy' })
  await broken.write('fail')
  const failing = assert.rejects(broken.flush(), { code: 'provider_failed' })
  HTTP.clients[0].requestOptions.onHeaders(500)
  await failing
  await assert.rejects(broken.write('late'), { code: 'provider_failed' })
  await assert.rejects(broken.endInput(), { code: 'provider_failed' })
  await broken.close()
})

test('aborting an idle synthesis ends its source, and closing endInput cannot start a queued request', async () => {
  const scope = createVoiceScope()
  const provider = OpenAISpeechTTS.create({ apiKey: 'test' })
  const idle = await provider.open({ ...scope, format: mono(24000), voice: 'alloy' })
  let reason: unknown
  subscribePcmSource(idle.output, {
    write() {},
    end(error) {
      reason = error
    },
  })
  scope.abort()
  assert.equal((reason as { code: string }).code, 'cancelled')
  await assert.rejects(idle.endInput(), { code: 'cancelled' })
  await idle.close()

  const synthesis = await provider.open({ ...createVoiceScope(), format: mono(24000), voice: 'alloy' })
  await synthesis.write('first')
  const flushing = assert.rejects(synthesis.flush(), { code: 'cancelled' })
  await synthesis.write('tail')
  const ending = assert.rejects(synthesis.endInput(), { code: 'cancelled' })
  await Promise.all([synthesis.close(), synthesis.close()])
  await Promise.all([flushing, ending])
  assert.equal(HTTP.clients.length, 1)
  DNS.pending[0].onResolved('api.openai.com', '127.0.0.1')
  assert.equal(HTTP.activeSockets, 0)
})

beforeEach(() => {
  Timer.reset()
  DNS.pending = []
  HTTP.clients = []
  HTTP.activeSockets = 0
  Object.assign(globalThis, {
    device: { network: { https: { client: { io: HTTP, dns: { io: DNS } } } } },
  })
})

for (const termination of ['abort', 'deadline'] as const) {
  test(`remote speech ignores late DNS after ${termination} and permits the next synthesis`, async () => {
    const provider = OpenAISpeechTTS.create({ apiKey: 'test' })
    const scope = createVoiceScope()
    const synthesis = await provider.open({ ...scope, format: mono(24000), voice: 'alloy' })
    await synthesis.write('first')
    const outcome = assert.rejects(synthesis.endInput(), {
      code: termination === 'abort' ? 'cancelled' : 'deadline_exceeded',
    })
    assert.equal(DNS.pending.length, 1)
    const late = DNS.pending[0]
    if (termination === 'abort') await synthesis.close()
    else Timer.advance(45000)
    await outcome
    assert.equal(HTTP.clients[0].closed, 1)
    late.onResolved('api.openai.com', '127.0.0.1')
    assert.equal(HTTP.activeSockets, 0, 'a settled request must not create a late socket')

    const next = await provider.open({ ...createVoiceScope(), format: mono(24000), voice: 'alloy' })
    const heard: number[] = []
    readSource(next.output, (bytes) => {
      heard.push(...bytes)
    })
    await next.write('second')
    const finished = next.endInput()
    DNS.pending[1].onResolved('api.openai.com', '127.0.0.1')
    late.onError(new Error('stale lookup failed'))
    assert.equal(HTTP.activeSockets, 1, 'stale lookup failure must not close a newer request')
    HTTP.clients[1].respond(Uint8Array.of(1, 2, 3, 4))
    await finished
    assert.deepEqual(heard, [1, 2, 3, 4])
    assert.equal(HTTP.clients[1].closed, 1)
    assert.equal(HTTP.activeSockets, 0)
    await synthesis.close()
    await next.close()
    Timer.advance(45000)
    assert.equal(HTTP.clients[0].closed, 1)
    assert.equal(HTTP.clients[1].closed, 1)
  })
}
