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
  'stackchan/voice/synthesis': '../synthesis.js',
  'realtimeConversation/http-core': '../../../../../host/modules/realtime-conversation/http-core.js',
}
const hooks = registerHooks({
  resolve(specifier, context, next) {
    return aliases[specifier]
      ? { shortCircuit: true, url: new URL(aliases[specifier], import.meta.url).href }
      : next(specifier, context)
  },
})
const { createOpenAISpeechTTS } = await import('../speech.js')
const { mono, readSource } = await import('../media.js')
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
  write(_bytes: DataView) {
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
    const provider = createOpenAISpeechTTS({ apiKey: 'test' })
    const scope = createVoiceScope()
    const synthesis = await provider.open({ ...scope, format: mono(24000), voice: 'alloy' })
    await synthesis.write('first')
    const outcome = assert.rejects(synthesis.finish(), {
      code: termination === 'abort' ? 'cancelled' : 'deadline_exceeded',
    })
    await new Promise((resolve) => setImmediate(resolve))
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
    const finished = next.finish()
    await new Promise((resolve) => setImmediate(resolve))
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
