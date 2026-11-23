import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import test, { beforeEach } from 'node:test'

ArrayBuffer.fromString = (value) => new TextEncoder().encode(value).buffer
String.fromArrayBuffer = (value) => new TextDecoder().decode(value)
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'timer') return next(new URL('../../testing/fakes/timer.ts', import.meta.url).href, context)
    if (specifier.startsWith('stackchan/voice/'))
      return next(new URL(`../${specifier.slice(16)}.ts`, import.meta.url).href, context)
    if (specifier.startsWith('stackchan-ai-'))
      return next(new URL(`../../ai/ai-${specifier.slice(13)}.ts`, import.meta.url).href, context)
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url.endsWith('/ai-wire.ts'))
      return {
        shortCircuit: true,
        format: 'module',
        source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'strip' }),
      }
    return next(url, context)
  },
})
const { GeminiSpeechTTS } = await import('../gemini-speech.ts')
const { mono, subscribePcmSource } = await import('../media.ts')
const { createVoiceScope } = await import('../scope.ts')
const { default: Timer } = await import('../../testing/fakes/timer.ts')
const sse = (value) => new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`)
const audio = (size) =>
  sse({
    event_type: 'step.delta',
    delta: { type: 'audio', mime_type: 'audio/l16;rate=24000', data: Buffer.alloc(size).toString('base64') },
  })
const terminal = sse({ event_type: 'interaction.completed', interaction: { status: 'completed' } })
beforeEach(() => Timer.reset())

async function playback({ seconds, initialDelay = 0 }) {
  let heard = 0,
    elapsed = 0,
    completed = false,
    attempted = 0
  const event = audio(48000)
  assert.equal(event.length, 64105)
  const result = await GeminiSpeechTTS.create({
    async request(_, consume) {
      Timer.advance(initialDelay)
      for (let i = 0; i < seconds; i++) {
        attempted++
        await consume(event)
      }
      await consume(terminal)
      completed = true
    },
  }).open({ ...createVoiceScope(), format: mono(24000), voice: 'Leda' })
  subscribePcmSource(result.output, {
    async write(bytes) {
      heard += bytes.length
      const next = Math.floor(heard / 48)
      Timer.advance(next - elapsed)
      elapsed = next
    },
    end() {},
  })
  await result.write('Synthetic pressure fixture')
  let error
  try {
    await result.endInput()
  } catch (value) {
    error = value
  }
  await result.close()
  return { heard, elapsed: elapsed + initialDelay, completed, attempted, error, eventBytes: event.length }
}

test('control: two seconds of healthy PCM completes within the default deadline', async () => {
  const f = await playback({ seconds: 2 })
  assert.equal(f.error, undefined)
  assert.equal(f.heard, 96000)
  assert.equal(f.elapsed, 2000)
  assert.equal(f.completed, true)
  assert.equal(f.attempted, 2)
})

for (const initialDelay of [0, 10000]) {
  test(`healthy playback renews the idle deadline, initial delay ${initialDelay}ms`, async () => {
    const f = await playback({ seconds: 60, initialDelay })
    assert.equal(f.error, undefined)
    assert.equal(f.elapsed, 60000 + initialDelay)
    assert.equal(f.heard, 60000 * 48)
    assert.equal(f.attempted, 60)
    assert.equal(f.completed, true)
  })
}

test('current failure: valid 49152-byte PCM delta exceeds the 65536-byte SSE budget before playback', async () => {
  const event = audio(49152)
  assert.equal(Buffer.alloc(49152).toString('base64').length, 65536)
  assert.equal(event.length, 65641)
  let heard = 0
  const result = await GeminiSpeechTTS.create({
    async request(_, consume) {
      for (let at = 0; at < event.length; at += 4096) await consume(event.subarray(at, at + 4096))
      await consume(terminal)
    },
  }).open({ ...createVoiceScope(), format: mono(24000), voice: 'Leda' })
  subscribePcmSource(result.output, {
    write(bytes) {
      heard += bytes.length
    },
    end() {},
  })
  await result.write('Synthetic size fixture')
  await assert.rejects(result.endInput(), { code: 'resource_exhausted' })
  assert.equal(heard, 0)
  assert.equal(49152 / 48, 1024)
  await result.close()
})

test('silent generation still reaches the 45 second deadline', async () => {
  const f = await playback({ seconds: 1, initialDelay: 45000 })
  assert.equal(f.error?.code, 'deadline_exceeded')
  assert.equal(f.heard, 0)
})
