import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { writeAliasPackage, writeAliasPackageSubpath } from '../../testing/node-alias-package.js'
import type { TelemetryEvent } from '../../util/telemetry.js'

type FakeTimeModule = typeof import('../../testing/fakes/time.js')

function installBareSpecifierPackages(): void {
  const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  writeAliasPackage(modulesRoot, 'calculate-power', resolve(modulesRoot, 'testing/fakes/calculate-power.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackageSubpath(modulesRoot, 'pins', 'audioout', resolve(modulesRoot, 'testing/fakes/audio-out.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackage(modulesRoot, 'tts-types', resolve(modulesRoot, 'audio/tts-types.js'))
  writeAliasPackage(modulesRoot, 'telemetry', resolve(modulesRoot, 'util/telemetry.js'))
  writeAliasPackage(modulesRoot, 'time', resolve(modulesRoot, 'testing/fakes/time.js'), { hasDefaultExport: true })
}

async function setup() {
  installBareSpecifierPackages()
  const [lifecycle, telemetry, time, audioOut] = await Promise.all([
    import('../tts-playback-lifecycle.js'),
    import('../../util/telemetry.js'),
    import('../../testing/fakes/time.js') as Promise<FakeTimeModule>,
    import('../../testing/fakes/audio-out.js'),
  ])
  ;(globalThis as typeof globalThis & { trace: (...messages: unknown[]) => void }).trace = () => {}
  audioOut.resetAudioOut()
  time.default.reset()
  return { ...lifecycle, ...telemetry, Time: time.default }
}

function collect(events: TelemetryEvent[], subscribe: (sink: (event: TelemetryEvent) => void) => () => void) {
  return subscribe((event) => events.push(event))
}

test('TTS playback telemetry reports first audio, stalls, and played gaps', async () => {
  const { beginTTSPlayback, getTelemetry, Time } = await setup()
  const events: TelemetryEvent[] = []
  const unsubscribe = collect(events, (sink) => getTelemetry().subscribe(sink))

  const owner = { streaming: false, telemetryName: 'test-engine' }
  const lifecycle = beginTTSPlayback(owner)
  assert.ok(lifecycle)
  lifecycle.openAudio({ streams: 1, sampleRate: 24000 }, 0.5)
  Time.set(50)
  lifecycle.onReady(true)
  Time.set(60)
  lifecycle.onPlayed(Uint8Array.of(1, 2).buffer)
  Time.set(80)
  lifecycle.onReady(false)
  Time.set(130)
  lifecycle.onReady(true)
  Time.set(150)
  lifecycle.onPlayed(Uint8Array.of(3, 4).buffer)
  Time.set(200)
  lifecycle.onDone()
  unsubscribe()

  assert.deepEqual(
    events.map((event) => event.ev),
    ['playback.begin', 'playback.audio_open', 'playback.first_audio', 'playback.stall', 'playback.end'],
  )
  const [begin, audioOpen, firstAudio, stall, end] = events
  assert.deepEqual(begin.data, { engine: 'test-engine' })
  assert.equal(audioOpen.id, begin.id)
  assert.deepEqual(audioOpen.data, { sampleRate: 24000 })
  assert.equal(firstAudio.dur, 50)
  assert.deepEqual(stall.data, { stallMs: 50 })
  assert.equal(end.dur, 200)
  assert.deepEqual(end.data, {
    played: 2,
    stalls: 1,
    stallMs: 50,
    maxGapMs: 90,
    firstAudioMs: 50,
  })
})

test('TTS playback telemetry counts a stall that is still open at failure time', async () => {
  const { beginTTSPlayback, getTelemetry, Time } = await setup()
  const events: TelemetryEvent[] = []
  const unsubscribe = collect(events, (sink) => getTelemetry().subscribe(sink))

  const owner = { streaming: false, telemetryName: 'test-engine' }
  const lifecycle = beginTTSPlayback(owner)
  assert.ok(lifecycle)
  lifecycle.openAudio({ streams: 1, sampleRate: 11025 }, 0.5)
  Time.set(10)
  lifecycle.onReady(true)
  Time.set(30)
  lifecycle.onReady(false)
  Time.set(70)
  lifecycle.onError('server returned 500')
  unsubscribe()

  const fail = events.at(-1)
  assert.ok(fail)
  assert.equal(fail.ev, 'playback.fail')
  assert.equal(fail.err, 'E_TTS_HTTP')
  assert.equal(fail.data?.stalls, 1)
  assert.equal(fail.data?.stallMs, 40)
  assert.equal(fail.data?.reason, 'server returned 500')
})

test('TTS playback telemetry reports busy rejections', async () => {
  const { beginTTSPlayback, getTelemetry } = await setup()
  const events: TelemetryEvent[] = []

  const owner = { streaming: false, telemetryName: 'test-engine' }
  const active = beginTTSPlayback(owner)
  assert.ok(active)
  const unsubscribe = collect(events, (sink) => getTelemetry().subscribe(sink))
  const duplicate = beginTTSPlayback(owner)
  unsubscribe()
  active.onDone()

  assert.equal(duplicate, undefined)
  assert.equal(events.length, 1)
  assert.equal(events[0].ev, 'playback.rejected')
  assert.equal(events[0].err, 'E_TTS_BUSY')
  assert.deepEqual(events[0].data, { engine: 'test-engine' })
})

test('classifyTTSError maps raw errors onto the stable vocabulary', async () => {
  const { classifyTTSError } = await setup()
  assert.equal(classifyTTSError(new Error('already playing')), 'E_TTS_BUSY')
  assert.equal(classifyTTSError('server returned 404'), 'E_TTS_HTTP')
  assert.equal(classifyTTSError(new Error('socket closed')), 'E_TTS_NET')
  assert.equal(classifyTTSError('DNS lookup failed'), 'E_TTS_NET')
  assert.equal(classifyTTSError(new Error('request aborted')), 'E_TTS_ABORTED')
  assert.equal(classifyTTSError(new Error('boom')), 'E_TTS_ERROR')
})
