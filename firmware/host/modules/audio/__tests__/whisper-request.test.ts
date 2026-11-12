import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { beforeEach, test } from 'node:test'
import Timer from '../../testing/fakes/timer.js'
import { createVoiceScope } from '../../voice/scope.js'
import type { MultipartPart } from '../whisper-multipart.js'

ArrayBuffer.fromString = (value) => new TextEncoder().encode(value).buffer
String.fromArrayBuffer = (value) => new TextDecoder().decode(value)
const aliases: Record<string, string> = {
  headers: 'data:text/javascript,export default globalThis.Headers',
  uuid: 'data:text/javascript,export default () => "12345678-1234-1234-1234-123456789012"',
  url: 'node:url',
  timer: '../../testing/fakes/timer.js',
  'whisper-multipart': '../whisper-multipart.js',
}
const hooks = registerHooks({
  resolve(specifier, context, next) {
    return aliases[specifier]
      ? { shortCircuit: true, url: new URL(aliases[specifier], import.meta.url).href }
      : next(specifier, context)
  },
})
const { default: Whisper } = await import('../stt-whisper.js')
hooks.deregister()

type RequestOptions = {
  method: string
  path: string
  headers: Headers
  onHeaders(status: number, headers: Headers, statusText?: string): void
  onWritable(this: HTTP, count: number): void
  onReadable(this: HTTP, count: number): void
  onDone(error?: Error): void
}

class HTTP {
  static clients: HTTP[] = []
  static requestFailure: Error | undefined
  options: { host: string; port: number; onError(error: Error): void }
  requestOptions!: RequestOptions
  closed = 0
  sent: number[] = []
  response = new ArrayBuffer(0)
  credit = 0
  writes = 0
  constructor(options: HTTP['options']) {
    this.options = options
    HTTP.clients.push(this)
  }
  request(options: RequestOptions) {
    if (HTTP.requestFailure) throw HTTP.requestFailure
    this.requestOptions = options
  }
  write(data: MultipartPart | DataView) {
    assert.ok(data.byteLength <= this.credit)
    assert.ok(data.byteLength <= 4096)
    assert.equal(++this.writes, 1)
    const bytes = ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data as ArrayBuffer)
    this.sent.push(...bytes)
    this.credit -= bytes.length
    return this.credit
  }
  grant(count: number) {
    this.credit = count
    this.writes = 0
    this.requestOptions.onWritable.call(this, count)
  }
  read(count: number) {
    assert.equal(count, this.response.byteLength)
    return this.response
  }
  respond(status: number, body: unknown) {
    this.response = ArrayBuffer.fromString(JSON.stringify(body))
    this.requestOptions.onHeaders(status, new Headers(), 'response')
    this.requestOptions.onReadable.call(this, this.response.byteLength)
    this.requestOptions.onDone()
  }
  close() {
    this.closed++
  }
}

async function turn() {
  await Promise.resolve()
  Timer.advance(0)
  await new Promise<void>((resolve) => setImmediate(resolve))
}
beforeEach(() => {
  HTTP.clients = []
  HTTP.requestFailure = undefined
  Timer.reset()
  Object.assign(globalThis, { device: { network: { https: { client: { io: HTTP } } } } })
})

test('Whisper starts HTTP after the caller returns and uploads audio views with writable credit', async () => {
  const scope = createVoiceScope()
  const backing = new Uint8Array(new SharedArrayBuffer(9000))
  for (let index = 0; index < backing.length; index++) backing[index] = index % 251
  const audio = backing.subarray(12, 8800)
  const result = new Whisper({ apiKey: 'test' }).transcribe(audio, scope.signal)
  try {
    assert.equal(HTTP.clients.length, 0)
    await turn()
    assert.equal(HTTP.clients.length, 1)
    const client = HTTP.clients[0]
    assert.equal(client.options.host, 'api.openai.com')
    assert.equal(client.options.port, 443)
    assert.equal(client.requestOptions.method, 'POST')
    assert.equal(client.requestOptions.path, '/v1/audio/transcriptions')
    const length = Number(client.requestOptions.headers.get('content-length'))
    client.grant(0)
    assert.equal(client.sent.length, 0)
    for (let count = 0; client.sent.length < length && count < 64; count++) client.grant(1400)
    assert.equal(client.sent.length, length)
    const sent = Uint8Array.from(client.sent)
    const prefix = new TextDecoder().decode(sent.subarray(0, 500))
    const marker = 'application/octet-stream\r\n\r\n'
    const markerStart = prefix.indexOf(marker)
    assert.ok(markerStart >= 0)
    const dataStart = markerStart + marker.length
    assert.deepEqual(sent.subarray(dataStart, dataStart + audio.length), audio)
    client.respond(200, { text: 'recognized' })
    assert.deepEqual(await result, { success: true, value: 'recognized' })
    assert.equal(client.closed, 1)
  } finally {
    scope.abort()
    await result
  }
})

test('abort before the deferred HTTP start creates no client or request', async () => {
  const scope = createVoiceScope()
  const result = new Whisper({ apiKey: 'test' }).transcribe(Uint8Array.of(1, 2), scope.signal)
  scope.abort(new Error('cancelled before start'))
  await turn()
  assert.deepEqual(await result, { success: false, reason: 'Exception occurred: cancelled before start' })
  assert.equal(HTTP.clients.length, 0)
})

test('Whisper keeps the detailed transport error after the SDK reports request completion first', async () => {
  const result = new Whisper({ apiKey: 'test' }).transcribe(Uint8Array.of(1, 2))
  await turn()
  const client = HTTP.clients[0]
  client.requestOptions.onDone(new Error())
  client.options.onError(new Error('TLS handshake failed'))
  assert.deepEqual(await result, { success: false, reason: 'Exception occurred: TLS handshake failed' })
  assert.equal(client.closed, 1)
})

test('Whisper reports an HTTP error and closes the client once', async () => {
  const result = new Whisper({ apiKey: 'test' }).transcribe(Uint8Array.of(1, 2))
  await turn()
  const client = HTTP.clients[0]
  client.respond(429, { error: { code: 'rate_limit_exceeded' } })
  assert.deepEqual(await result, { success: false, reason: 'transcription HTTP 429: rate_limit_exceeded' })
  assert.equal(client.closed, 1)
})

test('a request setup exception is returned as a provider failure after client cleanup', async () => {
  HTTP.requestFailure = new Error('request setup failed')
  const result = new Whisper({ apiKey: 'test' }).transcribe(Uint8Array.of(1, 2))
  assert.deepEqual(await result, { success: false, reason: 'Exception occurred: request setup failed' })
  assert.equal(HTTP.clients[0].closed, 1)
})

test('the request deadline remains active after deferred HTTP startup', async () => {
  const result = new Whisper({ apiKey: 'test' }).transcribe(Uint8Array.of(1, 2))
  await turn()
  const client = HTTP.clients[0]
  Timer.advance(29999)
  assert.equal(client.closed, 0)
  Timer.advance(1)
  assert.deepEqual(await result, { success: false, reason: 'Exception occurred: speech request timed out' })
  assert.equal(client.closed, 1)
})
