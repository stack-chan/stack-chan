import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { writeAliasPackageSubpath } from '../../testing/node-alias-package.js'
import type { AudioRuntime, Conversation, DuplexLease, VoiceSignal } from '../contracts.js'

const local = dirname(dirname(fileURLToPath(import.meta.url)))
writeAliasPackageSubpath(local, 'stackchan', 'voice/scope', resolve(local, 'scope.js'))
const { createConversationPipeline } = await import('../pipeline.js')
const { deferred } = await import('../scope.js')

function fixture() {
  const calls: string[] = []
  let inputWait: Promise<void> | undefined
  let openWait: Promise<void> | undefined
  let closeError: Error | undefined
  let signal: VoiceSignal
  const lease = {
    input: {},
    output: {},
    media: {},
    async setInputEnabled(enabled: boolean) {
      calls.push(`audio:${enabled}`)
    },
    setVolume(value: number) {
      calls.push(`volume:${value}`)
    },
    async close() {
      calls.push('release')
    },
  } as unknown as DuplexLease
  const runtime: AudioRuntime = {
    async acquire() {
      calls.push('acquire')
      return lease
    },
  }
  const conversation: Conversation = {
    audio: { input: [], output: [], duplex: 'half' },
    capabilities: {
      textInput: true,
      imageInput: false,
      inputRoles: ['user'],
      interruption: 'local-only',
      historyRepair: 'restart',
      interruptionReuse: 'restart-required',
      turnControl: 'provider',
      submitCompletion: 'unavailable',
    },
    async open(options) {
      signal = options.signal
      calls.push('open')
      await openWait
      return {
        id: 'one',
        async submit() {
          calls.push('submit')
          return { completion: 'unavailable' as const }
        },
        async setInputEnabled(value) {
          calls.push(`session:${value}`)
          await inputWait
        },
        async interrupt() {
          return { playback: [], remote: 'unknown', history: 'restart-required' }
        },
        async close() {
          calls.push('close')
          if (closeError) throw closeError
          return { reason: 'aborted', remoteFinalization: 'unknown' }
        },
      }
    },
  }
  const pipeline = createConversationPipeline({
    microphone: { id: 'mic', runtime },
    speaker: { id: 'speaker', runtime },
    conversation,
  })
  return {
    pipeline,
    calls,
    waitInput(value?: Promise<void>) {
      inputWait = value
    },
    waitOpen(value: Promise<void>) {
      openWait = value
    },
    failClose(value: Error) {
      closeError = value
    },
    get signal() {
      return signal
    },
  }
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

test('microphone can be muted before acquisition and repeated settings are idempotent', async () => {
  const { pipeline, calls } = fixture()
  await pipeline.setMicrophoneMuted(true)
  pipeline.setVolume(0.4)
  assert.deepEqual(calls, [])
  await pipeline.start()
  assert.ok(calls.indexOf('audio:false') < calls.indexOf('open'))
  assert.ok(!calls.includes('audio:true'))
  const length = calls.length
  await pipeline.setMicrophoneMuted(true)
  assert.equal(calls.length, length)
  await pipeline.setMicrophoneMuted(false)
  assert.deepEqual(calls.slice(-3), ['audio:false', 'session:true', 'audio:true'])
  await pipeline.close()
  await assert.rejects(pipeline.setMicrophoneMuted(false), { code: 'cancelled' })
  await assert.rejects(pipeline.start(), { code: 'device_busy' })
})

test('mute changes during start apply the latest state then preserve call order', async () => {
  const { pipeline, calls, waitOpen } = fixture()
  const opening = deferred<void>()
  waitOpen(opening.promise)
  await pipeline.setMicrophoneMuted(true)
  const started = pipeline.start()
  await tick()
  const unmute = pipeline.setMicrophoneMuted(false)
  opening.resolve()
  await Promise.all([started, unmute])
  assert.equal(calls.at(-1), 'audio:true')
  await pipeline.close()
})

test('close waits for the input operation and prevents a queued unmute from reopening the device', async () => {
  const { pipeline, calls, waitInput } = fixture()
  await pipeline.start()
  const input = deferred<void>()
  waitInput(input.promise)
  const mute = pipeline.setMicrophoneMuted(true)
  await tick()
  const unmute = assert.rejects(pipeline.setMicrophoneMuted(false), { code: 'cancelled' })
  const closing = pipeline.close()
  const marker = calls.length
  input.resolve()
  await Promise.all([mute, unmute, closing])
  assert.deepEqual(calls.slice(marker), ['close', 'release'])
  await pipeline.close()
  assert.equal(calls.filter((value) => value === 'release').length, 1)
})

test('unsupported roles and image input reject before reaching the backend', async () => {
  const { pipeline, calls } = fixture()
  await pipeline.start()
  await assert.rejects(pipeline.submit({ type: 'message', role: 'system', content: [] }), {
    code: 'unsupported_capability',
  })
  await assert.rejects(
    pipeline.submit({ type: 'message', role: 'user', content: [{ type: 'input_image', image_url: 'x' }] }),
    { code: 'unsupported_capability' },
  )
  assert.ok(!calls.includes('submit'))
  await pipeline.close()
})

test('a failed session close quarantines its audio lease and repeated close keeps the failure', async () => {
  const { pipeline, calls, failClose } = fixture()
  await pipeline.start()
  const failure = new Error('native callback still running')
  failClose(failure)
  await assert.rejects(pipeline.close(), failure)
  await assert.rejects(pipeline.close(), failure)
  assert.ok(!calls.includes('release'))
  assert.equal(calls.filter((value) => value === 'close').length, 1)
})

test('close cancels startup while the initial microphone command is pending', async () => {
  const f = fixture()
  const input = deferred<void>()
  f.waitInput(input.promise)
  const started = f.pipeline.start()
  const rejected = assert.rejects(started, { code: 'cancelled' })
  await tick()
  assert.ok(f.calls.includes('session:true'))
  f.signal.addEventListener('abort', () => input.reject(f.signal.reason))
  await f.pipeline.close()
  await rejected
  assert.equal(f.signal.aborted, true)
  assert.equal(f.calls.filter((value) => value === 'release').length, 1)
})
