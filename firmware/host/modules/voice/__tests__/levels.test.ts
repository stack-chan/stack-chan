import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import type { AudioLevel, DuplexLease } from '../contracts.js'
import { pcmLevel } from '../levels.js'
import type { LeaseOptions } from '../runtime-types.js'
import { createVoiceScope } from '../scope.js'
import './pcm-magnitude-fake.js'

const audioState = { callback: undefined as ((size: number) => void) | undefined }
const fakeAudioUrl = `data:text/javascript,${encodeURIComponent(`
export default class {
  sampleRate; channels = 1; bitsPerSample = 16;
  constructor(options) { this.sampleRate = options.sampleRate; globalThis.__voiceLevelsTest.callback = options.onWritable; }
  start() { globalThis.__voiceLevelsTest.callback(10240); }
  write() {}
  stop() {}
  close() {}
}`)}`
;(globalThis as typeof globalThis & { __voiceLevelsTest: typeof audioState }).__voiceLevelsTest = audioState
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'embedded:io/audio/out') return { shortCircuit: true, url: fakeAudioUrl }
    const local = {
      'stackchan/voice/scope': '../scope.js',
      'stackchan/voice/pcm-magnitude': './pcm-magnitude-fake.js',
    }[specifier]
    return local ? next(new URL(local, import.meta.url).href, context) : next(specifier, context)
  },
})
const { bindAudioRuntime } = await import('../runtime.js')
const { openOutput } = await import('../cores3-pcm-output.js')
hooks.deregister()

test('levels normalize signed PCM and respect a view offset', () => {
  const buffer = Uint8Array.of(99, 99, 0, 128, 0, 64, 0, 0)
  assert.equal(pcmLevel(buffer.subarray(2, 6)), 0.75)
  assert.equal(pcmLevel(new Uint8Array()), 0)
})

test('runtime gates mute, observer exceptions, cadence and closed leases', async () => {
  const scope = createVoiceScope()
  let emit: LeaseOptions['onLevel']
  let released = false
  const levels: AudioLevel[] = []
  const runtime = bindAudioRuntime(
    {
      acquireExclusive: () => () => {
        released = true
      },
    },
    (options) => {
      emit = options.onLevel
      return {
        input: {},
        output: {},
        media: {},
        async setInputEnabled() {},
        setVolume() {},
        async close() {},
      } as unknown as DuplexLease
    },
  )
  const lease = await runtime.acquire(
    runtime.microphone,
    runtime.speaker,
    { input: [], output: [], duplex: 'half' },
    {
      signal: scope.signal,
      budget: { maxBufferedBytes: 100, maxBufferedMs: 100 },
      onLevel(level) {
        levels.push(level)
        throw new Error('UI')
      },
    },
  )
  emit?.({ direction: 'output', value: 0.5 })
  emit?.({ direction: 'output', value: 0.8 })
  assert.equal(levels.length, 1)
  await lease.setInputEnabled(false)
  emit?.({ direction: 'input', value: 0.9 })
  assert.equal(levels.at(-1)?.value, 0)
  scope.abort()
  await lease.close()
  assert.deepEqual(levels.slice(-2), [
    { direction: 'input', value: 0 },
    { direction: 'output', value: 0 },
  ])
  assert.equal(released, true)
  const count = levels.length
  emit?.({ direction: 'output', value: 0.4 })
  assert.equal(levels.length, count)
})

test('aborted and rejected acquisitions cannot emit late levels', async () => {
  const scope = createVoiceScope()
  let emit: LeaseOptions['onLevel']
  let count = 0
  const runtime = bindAudioRuntime({ acquireExclusive: () => () => {} }, (options) => {
    emit = options.onLevel
    throw new Error('driver unavailable')
  })
  await assert.rejects(
    runtime.acquire(
      runtime.microphone,
      runtime.speaker,
      { input: [], output: [], duplex: 'half' },
      {
        signal: scope.signal,
        budget: { maxBufferedBytes: 100, maxBufferedMs: 100 },
        onLevel() {
          count++
        },
      },
    ),
  )
  emit?.({ direction: 'input', value: 1 })
  scope.abort()
  emit?.({ direction: 'output', value: 1 })
  assert.equal(count, 0)
})

test('PCM output levels wait for confirmed playback rather than queued data', async () => {
  const levels: number[] = []
  const output = openOutput(16000, 0.5, 10240, (value) => levels.push(value))
  const bytes = new Uint8Array(4096)
  const samples = new DataView(bytes.buffer)
  for (let offset = 0; offset < bytes.length; offset += 2) samples.setInt16(offset, 16384, true)
  await output.write(bytes)
  assert.deepEqual(levels, [])
  audioState.callback?.(10240)
  assert.deepEqual(levels, [0.25])
  output.close()
  assert.equal(levels.at(-1), 0)
  const count = levels.length
  audioState.callback?.(10240)
  assert.equal(levels.length, count)
})
