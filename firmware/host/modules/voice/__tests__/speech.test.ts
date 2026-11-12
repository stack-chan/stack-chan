import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import type { Transcript } from '../contracts.js'
import { createVoiceScope, deferred } from '../scope.js'
import { transcription } from './whisper-stub.js'

ArrayBuffer.fromString = (value) => new TextEncoder().encode(value).buffer
const aliases: Record<string, string> = {
  headers: 'data:text/javascript,export default globalThis.Headers',
  'stt-whisper': './whisper-stub.js',
  'stackchan/voice/pcm-http': '../pcm-http.js',
  'stackchan/voice/media': '../media.js',
  'stackchan/voice/scope': '../scope.js',
  'stackchan/voice/synthesis': '../synthesis.js',
  'realtimeConversation/http-core': '../../../../../host/modules/realtime-conversation/http-core.js',
  timer: '../../testing/fakes/timer.js',
}
const hooks = registerHooks({
  resolve(specifier, context, next) {
    return aliases[specifier]
      ? { shortCircuit: true, url: new URL(aliases[specifier], import.meta.url).href }
      : next(specifier, context)
  },
})
const { createOpenAISpeechTTS, createWhisperSTT } = await import('../speech.js')
const { createPcmSink, mono, pcmMedia, writeSink } = await import('../media.js')
hooks.deregister()

test('Whisper shares in-flight finalization and publishes one final snapshot after input closes', async () => {
  const response = deferred<{ success: true; value: string }>()
  let requests = 0
  transcription.run = (audio) => {
    requests++
    assert.equal(audio.byteLength, 48)
    return response.promise
  }
  const scope = createVoiceScope(),
    results: Transcript[] = []
  const session = await createWhisperSTT({ apiKey: 'test' }).open({
    ...scope,
    utteranceId: 'u1',
    format: mono(16000),
    onTranscript: (result) => results.push(result),
  })
  await writeSink(session.input, Uint8Array.of(1, 0, 2, 0))
  assert.equal(requests, 0)
  const finished = session.finish()
  assert.equal(session.finish(), finished)
  assert.deepEqual(results, [])
  await assert.rejects(writeSink(session.input, Uint8Array.of(3, 0)), { code: 'input_overrun' })
  response.resolve({ success: true, value: '今日は晴れ' })
  await finished
  assert.equal(requests, 1)
  assert.deepEqual(results, [{ utteranceId: 'u1', text: '今日は晴れ', final: true }])
  await session.close()
})

test('Whisper does not publish a late result after close', async () => {
  const response = deferred<{ success: true; value: string }>()
  transcription.run = () => response.promise
  let notifications = 0
  const session = await createWhisperSTT({ apiKey: 'test' }).open({
    ...createVoiceScope(),
    utteranceId: 'u2',
    format: mono(16000),
    onTranscript: () => notifications++,
  })
  await writeSink(session.input, Uint8Array.of(1, 0))
  const stopped = assert.rejects(session.finish(), { code: 'cancelled' })
  const closing = session.close()
  response.resolve({ success: true, value: '遅れた結果' })
  await closing
  await stopped
  assert.equal(notifications, 0)
})

type ResponseCallbacks = {
  onHeaders(status: number): void
  onWritable(this: SpeechHTTP, count: number): void
  onReadable(this: SpeechHTTP, count: number): void
  onDone(): void
}
class SpeechHTTP {
  static requests: SpeechHTTP[] = []
  closed = false
  body = ''
  callbacks!: ResponseCallbacks
  request(callbacks: ResponseCallbacks) {
    this.callbacks = callbacks
    SpeechHTTP.requests.push(this)
  }
  write(data: DataView) {
    this.body += new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
  }
  read(target: Uint8Array) {
    target.set([1, 0, 2, 0])
    return 4
  }
  respond() {
    this.callbacks.onHeaders(200)
    this.callbacks.onWritable.call(this, 65536)
    this.callbacks.onReadable.call(this, 4)
    this.callbacks.onDone()
  }
  close() {
    this.closed = true
  }
}

test('OpenAI TTS streams two flushed HTTP responses through one output with playback backpressure', async () => {
  Object.assign(globalThis, { device: { network: { https: { client: { io: SpeechHTTP, dns: { io: class {} } } } } } })
  SpeechHTTP.requests = []
  const scope = createVoiceScope(),
    credit = deferred<void>()
  const session = await createOpenAISpeechTTS({ apiKey: 'test' }).open({
    ...scope,
    voice: 'alloy',
    format: mono(24000),
  })
  let chunks = 0,
    ended = false,
    flushed = false
  const link = await pcmMedia.connect(
    session.output,
    createPcmSink(mono(24000), () => {
      if (++chunks === 1) return credit.promise
    }),
    { ...scope, budget: { maxBufferedBytes: 4096, maxBufferedMs: 100 } },
  )
  void link.done.then(() => {
    ended = true
  })
  await session.write('一。')
  const flush = session.flush().then(() => {
    flushed = true
  })
  await new Promise((ok) => setImmediate(ok))
  SpeechHTTP.requests[0].respond()
  await new Promise((ok) => setImmediate(ok))
  assert.equal(flushed, false)
  credit.resolve()
  await flush
  assert.equal(ended, false)
  assert.equal(SpeechHTTP.requests[0].closed, true)
  await session.write('二。')
  const finish = session.finish()
  assert.equal(session.finish(), finish)
  await new Promise((ok) => setImmediate(ok))
  SpeechHTTP.requests[1].respond()
  await finish
  await link.done
  assert.equal(chunks, 2)
  assert.deepEqual(
    SpeechHTTP.requests.map((request) => JSON.parse(request.body).input),
    ['一。', '二。'],
  )
  assert.ok(SpeechHTTP.requests.every((request) => request.closed))
  await session.close()
  await link.close()
})
