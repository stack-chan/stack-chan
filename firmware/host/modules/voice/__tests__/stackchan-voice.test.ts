import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import { createVoiceScope, deferred } from '../scope.js'
import { native } from './native-voice-stub.js'

ArrayBuffer.fromString = (value) => new TextEncoder().encode(value).buffer
const aliases: Record<string, string> = {
  stackchanvoice: './native-voice-stub.js',
  Resource: '../../audio/__tests__/stackchan-voice-device/resource-stub.js',
  'stackchan/voice/media': '../media.js',
  'stackchan/voice/scope': '../scope.js',
  timer: '../../testing/fakes/timer.js',
}
const hooks = registerHooks({
  resolve(specifier, context, next) {
    return aliases[specifier]
      ? { shortCircuit: true, url: new URL(aliases[specifier], import.meta.url).href }
      : next(specifier, context)
  },
})
const { createStackchanVoiceTTS } = await import('../stackchan-voice.js')
const { mono, readSource } = await import('../media.js')
const { default: timer } = await import('../../testing/fakes/timer.js')
hooks.deregister()

test('StackchanVoice reuses each native block after acceptance and cancels borrowed output', async (t) => {
  t.mock.method(Date, 'now', () => 0)
  const tts = createStackchanVoiceTTS({ speed: 85, voice: 'cute' })
  const scope = createVoiceScope()
  const args = { ...scope, format: mono(24000), voice: 'default' }
  const session = await tts.open(args)
  await assert.rejects(tts.open(args), { code: 'device_busy' })
  const accepted = deferred<void>()
  const blocks: Uint8Array[] = []
  readSource(session.output, (bytes) => {
    blocks.push(bytes)
    if (blocks.length === 1) return accepted.promise
  })
  await session.write('こん')
  await session.write('にちは')
  const done = session.finish()
  assert.equal(session.finish(), done)
  assert.equal(blocks.length, 1)
  assert.equal(native.reads, 1)
  assert.equal(blocks[0].byteLength, 2048)
  assert.deepEqual(native.starts.at(-1), { method: 'say', text: 'こんにちは', speed: 85, preset: 1 })
  accepted.resolve()
  await new Promise((ok) => setImmediate(ok))
  assert.equal(blocks.length, 2, 'Speaker credit resumes synthesis without a timer tick')
  await done
  assert.deepEqual(
    blocks.map((block) => block.byteLength),
    [2048, 52],
  )
  assert.equal(blocks[0].buffer, blocks[1].buffer)
  await session.close()

  const song = await tts.openKoe({ ...args, voice: 'normal' })
  const neverReleased = deferred<void>()
  readSource(song.output, () => neverReleased.promise)
  await song.write('a')
  const singing = song.finish()
  scope.abort()
  await assert.rejects(singing, { code: 'cancelled' })
  assert.deepEqual(native.starts.at(-1), { method: 'koe', text: 'a', speed: 85, preset: 0 })
  assert.equal(native.instances, 1)
  const next = await tts.open({ ...args, ...createVoiceScope() })
  const reads = native.reads
  neverReleased.resolve()
  await new Promise((ok) => setImmediate(ok))
  timer.advance(1)
  assert.equal(native.reads, reads)
  await next.close()
})

test('StackchanVoice rejects incompatible formats, truncated Koe and invalid native frame counts', async () => {
  assert.throws(() => createStackchanVoiceTTS({ speed: 0 }), RangeError)
  const tts = createStackchanVoiceTTS()
  const args = { ...createVoiceScope(), voice: 'normal', format: mono(24000) }
  await assert.rejects(tts.open({ ...args, format: mono(16000) }), { code: 'unsupported_capability' })
  await assert.rejects(tts.open({ ...args, voice: 'alloy' }), { code: 'unsupported_capability' })
  const session = await tts.openKoe(args)
  await assert.rejects(session.write('a'.repeat(2048)), { code: 'resource_exhausted' })
  await session.write('あ'.repeat(683))
  await assert.rejects(session.finish(), { code: 'resource_exhausted' })
  const invalid = await tts.open(args)
  native.invalidCount = true
  try {
    await invalid.write('音')
    await assert.rejects(invalid.finish(), { code: 'provider_failed' })
  } finally {
    native.invalidCount = false
  }
})

test('StackchanVoice yields between bounded batches even without backpressure', async () => {
  const originalFrames = native.frames
  const now = Date.now
  let elapsed = 0
  Date.now = () => elapsed
  native.frames = 40 * 1024
  try {
    for (const mode of ['no-reader', 'immediate-promise', 'busy-microtask', 'slow-reader']) {
      const scope = createVoiceScope()
      const synthesis = await createStackchanVoiceTTS().open({ ...scope, voice: 'normal', format: mono(24000) })
      if (mode === 'immediate-promise') readSource(synthesis.output, () => Promise.resolve())
      if (mode === 'busy-microtask')
        readSource(synthesis.output, () =>
          Promise.resolve().then(() => {
            elapsed += 12
          }),
        )
      if (mode === 'slow-reader')
        readSource(synthesis.output, () => {
          elapsed += 12
        })
      await synthesis.write('声')
      const before = native.reads
      const done = synthesis.finish()
      await new Promise((ok) => setImmediate(ok))
      assert.equal(native.reads - before, mode === 'slow-reader' ? 1 : 4)
      scope.abort()
      await assert.rejects(done, { code: 'cancelled' })
      const stopped = native.reads
      timer.advance(10)
      assert.equal(native.reads, stopped)
    }
  } finally {
    native.frames = originalFrames
    Date.now = now
  }
})
