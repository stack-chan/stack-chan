import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage } from '../testing/node-alias-package.js'

type FakeTimeModule = typeof import('../testing/fakes/time.js')

function installBareSpecifierPackages(): void {
  const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  writeAliasPackage(modulesRoot, 'time', resolve(modulesRoot, 'testing/fakes/time.js'), { hasDefaultExport: true })
}

async function setup() {
  installBareSpecifierPackages()
  const [telemetry, time] = await Promise.all([
    import('./telemetry.js'),
    import('../testing/fakes/time.js') as Promise<FakeTimeModule>,
  ])
  ;(globalThis as typeof globalThis & { trace: (...messages: unknown[]) => void }).trace = () => {}
  time.default.reset()
  return { ...telemetry, Time: time.default }
}

test('telemetry events carry schema version, sequence, and timestamp', async () => {
  const { TelemetryChannel, Time } = await setup()
  const channel = new TelemetryChannel()

  Time.set(120)
  const first = channel.emit('tts', 'playback.begin')
  Time.set(150)
  const second = channel.emit('tts', 'playback.end', { err: 'E_TTS_ERROR', dur: 30, data: { engine: 'test' } })

  assert.equal(first.v, 1)
  assert.equal(first.seq, 1)
  assert.equal(first.t, 120)
  assert.equal(first.mod, 'tts')
  assert.equal(first.ev, 'playback.begin')
  assert.equal(first.mem, undefined)
  assert.equal(second.seq, 2)
  assert.equal(second.t, 150)
  assert.equal(second.err, 'E_TTS_ERROR')
  assert.equal(second.dur, 30)
  assert.deepEqual(second.data, { engine: 'test' })
})

test('telemetry spans settle once and correlate events by id', async () => {
  const { TelemetryChannel, Time } = await setup()
  const channel = new TelemetryChannel()

  Time.set(1000)
  const span = channel.begin('tts', 'playback', { engine: 'test' })
  Time.set(1040)
  span.mark('playback.first_audio')
  Time.set(1100)
  span.end({ data: { played: 3 } })
  span.fail('E_TTS_ERROR')
  span.end()

  const events = channel.history()
  assert.deepEqual(
    events.map((event) => event.ev),
    ['playback.begin', 'playback.first_audio', 'playback.end'],
  )
  const [begin, mark, end] = events
  assert.equal(begin.id, span.id)
  assert.equal(begin.id, begin.seq)
  assert.deepEqual(begin.data, { engine: 'test' })
  assert.equal(mark.id, span.id)
  assert.equal(mark.dur, 40)
  assert.equal(end.id, span.id)
  assert.equal(end.dur, 100)
  assert.deepEqual(end.data, { played: 3 })
})

test('telemetry span fail records the error code and duration', async () => {
  const { TelemetryChannel, Time } = await setup()
  const channel = new TelemetryChannel()

  Time.set(0)
  const span = channel.begin('mic', 'record')
  Time.set(25)
  assert.equal(span.elapsed(), 25)
  span.fail('E_MIC_ABORTED', { data: { reason: 'stopped' } })

  const fail = channel.history().at(-1)
  assert.ok(fail)
  assert.equal(fail.ev, 'record.fail')
  assert.equal(fail.err, 'E_MIC_ABORTED')
  assert.equal(fail.dur, 25)
  assert.deepEqual(fail.data, { reason: 'stopped' })
})

test('telemetry history keeps only the newest events', async () => {
  const { TelemetryChannel } = await setup()
  const channel = new TelemetryChannel({ historySize: 3 })

  for (let index = 0; index < 5; index += 1) {
    channel.emit('tts', `event.${index}`)
  }

  assert.deepEqual(
    channel.history().map((event) => event.ev),
    ['event.2', 'event.3', 'event.4'],
  )
  assert.equal(channel.history().at(-1)?.seq, 5)
})

test('telemetry sinks are isolated and can unsubscribe', async () => {
  const { TelemetryChannel } = await setup()
  const channel = new TelemetryChannel()
  const seen: string[] = []

  channel.subscribe(() => {
    throw new Error('broken sink')
  })
  const unsubscribe = channel.subscribe((event) => seen.push(event.ev))

  channel.emit('tts', 'playback.begin')
  unsubscribe()
  channel.emit('tts', 'playback.end')

  assert.deepEqual(seen, ['playback.begin'])
})

test('telemetry samples memory when a sampler is installed', async () => {
  const { TelemetryChannel } = await setup()
  const channel = new TelemetryChannel({ memory: () => 4096 })

  assert.equal(channel.emit('tts', 'playback.begin').mem, 4096)
  channel.setMemorySampler(undefined)
  assert.equal(channel.emit('tts', 'playback.end').mem, undefined)
})

test('telemetry trace sink writes prefixed JSON lines', async () => {
  const { TelemetryChannel, createTraceSink, TELEMETRY_TRACE_PREFIX } = await setup()
  const channel = new TelemetryChannel()
  const lines: string[] = []
  channel.subscribe(createTraceSink((line) => lines.push(line)))

  channel.emit('speaker', 'play.begin', { data: { bytes: 128 } })

  assert.equal(lines.length, 1)
  assert.ok(lines[0].startsWith(TELEMETRY_TRACE_PREFIX))
  const parsed = JSON.parse(lines[0].slice(TELEMETRY_TRACE_PREFIX.length))
  assert.equal(parsed.mod, 'speaker')
  assert.equal(parsed.ev, 'play.begin')
  assert.deepEqual(parsed.data, { bytes: 128 })
})

test('telemetry shared channel is a lazily created singleton', async () => {
  const { getTelemetry } = await setup()
  const traced: string[] = []
  ;(globalThis as typeof globalThis & { trace: (message: string) => void }).trace = (message: string) =>
    traced.push(message)

  const channel = getTelemetry()
  assert.equal(getTelemetry(), channel)
  channel.emit('tts', 'playback.begin')

  assert.ok(traced.some((line) => line.includes('"ev":"playback.begin"')))
})

test('telemetry truncates long failure reasons', async () => {
  const { truncateReason } = await setup()
  const long = 'x'.repeat(200)
  assert.equal(truncateReason('short'), 'short')
  assert.equal(truncateReason(long).length, 123)
  assert.ok(truncateReason(long).endsWith('...'))
})
