import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { beforeEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { getAudioOutInstances, resetAudioOut } from '../../testing/fakes/audio-out.js'
import { getMP3StreamerInstances, resetMP3Streamers } from '../../testing/fakes/mp3streamer.js'
import Timer from '../../testing/fakes/timer.js'
import { writeAliasPackage, writeAliasPackageSubpath } from '../../testing/node-alias-package.js'

type WebRadioModule = typeof import('../platforms/m5stackchan-cores3/web-radio-player.js')

function installAliases(): void {
  const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  writeAliasPackage(modulesRoot, 'capabilities', resolve(modulesRoot, 'testing/fakes/capabilities.js'))
  writeAliasPackageSubpath(modulesRoot, 'pins', 'audioout', resolve(modulesRoot, 'testing/fakes/audio-out.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackage(modulesRoot, 'mp3streamer', resolve(modulesRoot, 'testing/fakes/mp3streamer.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackage(modulesRoot, 'timer', resolve(modulesRoot, 'testing/fakes/timer.js'), { hasDefaultExport: true })
}

beforeEach(() => {
  installAliases()
  resetAudioOut()
  resetMP3Streamers()
  Timer.reset()
  ;(globalThis as typeof globalThis & { device: unknown }).device = {
    network: { http: { name: 'http' }, https: { name: 'https' } },
  }
  ;(globalThis as typeof globalThis & { trace: (...args: unknown[]) => void }).trace = () => {}
})

test('WebRadioPlayer parses HTTPS URL including query and controls AudioOut readiness', async () => {
  const { default: WebRadioPlayer } = (await import(
    '../platforms/m5stackchan-cores3/web-radio-player.js'
  )) as WebRadioModule
  const states: string[] = []
  const player = new WebRadioPlayer()
  await player.start({
    url: 'https://radio.example.test:8443/live.mp3?quality=high',
    volume: 0.25,
    onStateChanged: (state) => states.push(state),
  })

  const streamer = getMP3StreamerInstances()[0]
  const audio = getAudioOutInstances()[0]
  assert.equal(streamer.options.host, 'radio.example.test')
  assert.equal(streamer.options.port, 8443)
  assert.equal(streamer.options.path, '/live.mp3?quality=high')
  assert.deepEqual(streamer.options.http, { name: 'https' })
  assert.equal(audio.enqueued[0].value, 64)

  streamer.options.onReady?.(true)
  assert.equal(player.state, 'playing')
  assert.equal(audio.started, 1)
  streamer.options.onReady?.(false)
  assert.equal(player.state, 'stalled')
  assert.equal(audio.stopped, 1)
  assert.deepEqual(states, ['connecting', 'buffering', 'playing', 'stalled'])
})

test('WebRadioPlayer selects HTTP defaults and reconnects with backoff', async () => {
  const { default: WebRadioPlayer } = (await import(
    '../platforms/m5stackchan-cores3/web-radio-player.js'
  )) as WebRadioModule
  const player = new WebRadioPlayer()
  await player.start({ url: 'http://radio.example.test/stream' })
  const first = getMP3StreamerInstances()[0]
  assert.equal(first.options.port, 80)
  assert.deepEqual(first.options.http, { name: 'http' })

  first.options.onError?.('offline')
  assert.equal(player.state, 'retrying')
  assert.equal(first.closed, true)
  Timer.advance(999)
  assert.equal(getMP3StreamerInstances().length, 1)
  Timer.advance(1)
  assert.equal(getMP3StreamerInstances().length, 2)
})

test('WebRadioPlayer stop cancels reconnect and is idempotent', async () => {
  const { default: WebRadioPlayer } = (await import(
    '../platforms/m5stackchan-cores3/web-radio-player.js'
  )) as WebRadioModule
  const player = new WebRadioPlayer()
  await player.start({ url: 'https://radio.example.test/stream' })
  getMP3StreamerInstances()[0].options.onDone?.()
  player.stop()
  player.stop()
  Timer.advance(30_000)
  assert.equal(getMP3StreamerInstances().length, 1)
  assert.equal(getAudioOutInstances()[0].closed, true)
  assert.equal(player.state, 'idle')
})

test('WebRadioPlayer validates volume, scheme, and sample rate', async () => {
  const { default: WebRadioPlayer } = (await import(
    '../platforms/m5stackchan-cores3/web-radio-player.js'
  )) as WebRadioModule
  const player = new WebRadioPlayer()
  await assert.rejects(player.start({ url: 'ftp://radio.example.test/stream' }), /HTTP and HTTPS/)
  await assert.rejects(player.start({ url: 'https://radio.example.test/stream', volume: 2 }), /between 0 and 1/)
  await assert.rejects(player.start({ url: 'https://radio.example.test/stream', sampleRate: 22050 }), /44100/)
})
