import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { beforeEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import type { Speaker } from '../../voice/contracts.js'
import AudioOut, {
  getAudioOutInstances,
  resetAudioOut,
  setAudioOutConstructorFailure,
} from '../../testing/fakes/audio-out.js'
import {
  getMP3StreamerInstances,
  resetMP3Streamers,
  setMP3StreamerConstructorFailure,
} from '../../testing/fakes/mp3streamer.js'
import Timer from '../../testing/fakes/timer.js'
import { writeAliasPackage, writeAliasPackageSubpath } from '../../testing/node-alias-package.js'

type WebRadioModule = typeof import('../platforms/m5stackchan-cores3/web-radio-player.js')

function installAliases(): void {
  const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  writeAliasPackage(modulesRoot, 'volume-model', resolve(modulesRoot, 'preferences/volume-model.js'))
  writeAliasPackage(modulesRoot, 'capabilities', resolve(modulesRoot, 'testing/fakes/capabilities.js'))
  writeAliasPackageSubpath(modulesRoot, 'pins', 'audioout', resolve(modulesRoot, 'testing/fakes/audio-out.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackage(modulesRoot, 'mp3streamer', resolve(modulesRoot, 'testing/fakes/mp3streamer.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackage(modulesRoot, 'buffered-mp3streamer', resolve(modulesRoot, 'testing/fakes/mp3streamer.js'), {
    hasDefaultExport: true,
  })
  for (const name of ['media', 'scope'])
    writeAliasPackageSubpath(modulesRoot, 'stackchan', 'voice/' + name, resolve(modulesRoot, 'voice/' + name + '.js'))
  writeAliasPackage(
    modulesRoot,
    'web-radio-audio-out',
    resolve(modulesRoot, 'audio/platforms/m5stackchan-cores3/web-radio-audio-out.js'),
    {
      hasDefaultExport: true,
    },
  )
  writeAliasPackage(modulesRoot, 'pcm-resampler', resolve(modulesRoot, 'testing/fakes/pcm-resampler.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackage(
    modulesRoot,
    'media-player',
    resolve(modulesRoot, 'audio/platforms/m5stackchan-cores3/media-player.js'),
    { hasDefaultExport: true },
  )
  writeAliasPackage(modulesRoot, 'timer', resolve(modulesRoot, 'testing/fakes/timer.js'), { hasDefaultExport: true })
}

function speaker(): Speaker {
  return {
    id: 'speaker',
    runtime: {
      async acquire() {
        throw new Error('capture requested')
      },
      async acquirePlayback(_speaker, _formats, { budget }) {
        const { createPcmSink, mono, pcmMedia } = await import('../../voice/media.js')
        const driver = new AudioOut({ sampleRate: 24000 })
        const sink = createPcmSink(mono(24000), (bytes) => driver.write(bytes))
        return {
          media: pcmMedia,
          output: {
            ...sink,
            budget,
            begin() {
              driver.start()
              return sink
            },
            async finish(outputId) {
              return { outputId, generation: 0, state: 'played', position: { basis: 'unknown' } }
            },
            async fence() {
              return []
            },
          },
          setVolume(volume) {
            driver.enqueue(0, AudioOut.Volume, Math.round(volume * 256))
          },
          async close() {
            try {
              driver.stop()
            } finally {
              driver.close()
            }
          },
        }
      },
    },
  }
}

const tick = () => new Promise<void>((done) => setImmediate(done))

beforeEach(() => {
  installAliases()
  resetAudioOut()
  resetMP3Streamers()
  Timer.reset()
  ;(globalThis as typeof globalThis & { device: unknown }).device = {
    network: { http: { client: { name: 'http' } }, https: { client: { name: 'https' } } },
  }
  ;(globalThis as typeof globalThis & { trace: (...args: unknown[]) => void }).trace = () => {}
})

test('WebRadio bundles the CA certificate required by supported HTTPS streams', () => {
  const manifest = JSON.parse(readFileSync('host/modules/audio/manifest.json', 'utf8')) as {
    data: { '*': string[] }
  }

  assert.ok(manifest.data['*'].includes('$(MODULES)/crypt/data/ca176'))
})

test('WebRadioPlayer parses HTTPS URL, limits volume, and controls AudioOut readiness', async () => {
  const { default: WebRadioPlayer } = (await import(
    '../platforms/m5stackchan-cores3/web-radio-player.js'
  )) as WebRadioModule
  const states: string[] = []
  const player = new WebRadioPlayer(speaker)
  await player.start({
    url: 'https://radio.example.test:8443/live.mp3?quality=high',
    volume: 0.25,
    onStateChanged: (state) => states.push(state),
  })

  const streamer = getMP3StreamerInstances()[0]
  const audio = getAudioOutInstances()[0]
  assert.equal(streamer.options.host, 'radio.example.test')
  assert.equal(streamer.options.protocol, 'https')
  assert.equal(streamer.options.port, 8443)
  assert.equal(streamer.options.path, '/live.mp3?quality=high')
  assert.deepEqual(streamer.options.http, { name: 'https' })
  assert.equal(audio.options.sampleRate, 24000)
  assert.equal(streamer.options.audio.sampleRate, 44100)
  assert.equal(audio.enqueued[0].value, Math.round(0.2 * 256))

  streamer.options.onReady?.(true)
  assert.equal(player.state, 'buffering')
  streamer.options.onPlayed?.()
  assert.equal(player.state, 'playing')
  assert.equal(audio.started, 1)
  streamer.options.onReady?.(false)
  assert.equal(player.state, 'stalled')
  assert.equal(audio.stopped, 0)
  streamer.options.onReady?.(true)
  streamer.options.onPlayed?.()
  assert.equal(player.state, 'playing')
  assert.deepEqual(states, ['connecting', 'buffering', 'playing', 'stalled', 'buffering', 'playing'])
})

test('WebRadioPlayer selects HTTP defaults and reconnects with backoff', async () => {
  const { default: WebRadioPlayer } = (await import(
    '../platforms/m5stackchan-cores3/web-radio-player.js'
  )) as WebRadioModule
  const player = new WebRadioPlayer(speaker)
  await player.start({ url: 'http://radio.example.test/stream' })
  const first = getMP3StreamerInstances()[0]
  assert.equal(first.options.protocol, 'http')
  assert.equal(first.options.port, 80)
  assert.equal(first.options.reconnect, true)
  assert.deepEqual(first.options.http, { name: 'http' })

  first.options.onError?.('offline')
  first.options.onDone?.()
  assert.equal(player.state, 'retrying')
  assert.equal(first.closed, true)
  Timer.advance(999)
  assert.equal(getMP3StreamerInstances().length, 1)
  Timer.advance(1)
  await tick()
  assert.equal(getMP3StreamerInstances().length, 2)
})

test('WebRadioPlayer reports transport failures without retry when reconnect is disabled', async () => {
  const { default: WebRadioPlayer } = (await import(
    '../platforms/m5stackchan-cores3/web-radio-player.js'
  )) as WebRadioModule
  const states: string[] = []
  const player = new WebRadioPlayer(speaker)
  await player.start({
    url: 'http://radio.example.test/stream',
    reconnect: false,
    onStateChanged: (state) => states.push(state),
  })
  const streamer = getMP3StreamerInstances()[0]
  assert.equal(streamer.options.reconnect, false)

  streamer.options.onError?.('offline')
  assert.equal(player.state, 'error')
  assert.equal(streamer.closed, true)
  Timer.advance(30_000)
  assert.equal(getMP3StreamerInstances().length, 1)
  assert.deepEqual(states, ['connecting', 'buffering', 'error'])
})

test('WebRadioPlayer retries synchronous AudioOut construction failures', async () => {
  const { default: WebRadioPlayer } = (await import(
    '../platforms/m5stackchan-cores3/web-radio-player.js'
  )) as WebRadioModule
  setAudioOutConstructorFailure(new Error('AudioOut allocation failed'))
  const player = new WebRadioPlayer(speaker)

  await player.start({ url: 'https://radio.example.test/stream' })
  assert.equal(player.state, 'retrying')
  assert.equal(getAudioOutInstances().length, 0)

  setAudioOutConstructorFailure(undefined)
  Timer.advance(1000)
  await tick()
  assert.equal(getAudioOutInstances().length, 1)
  assert.equal(getMP3StreamerInstances().length, 1)
})

test('WebRadioPlayer closes AudioOut and retries synchronous streamer construction failures', async () => {
  const { default: WebRadioPlayer } = (await import(
    '../platforms/m5stackchan-cores3/web-radio-player.js'
  )) as WebRadioModule
  setMP3StreamerConstructorFailure(new Error('streamer allocation failed'))
  const player = new WebRadioPlayer(speaker)

  await player.start({ url: 'https://radio.example.test/stream' })
  assert.equal(player.state, 'retrying')
  await tick()
  assert.equal(getAudioOutInstances()[0].closed, true)

  setMP3StreamerConstructorFailure(undefined)
  Timer.advance(1000)
  await tick()
  assert.equal(getMP3StreamerInstances().length, 1)
})

test('WebRadioPlayer closes AudioOut when flush or stop throws', async () => {
  const { default: WebRadioPlayer } = (await import(
    '../platforms/m5stackchan-cores3/web-radio-player.js'
  )) as WebRadioModule
  const flushFailurePlayer = new WebRadioPlayer(speaker)
  await flushFailurePlayer.start({ url: 'https://radio.example.test/stream' })
  const flushFailureAudio = getAudioOutInstances()[0]
  flushFailureAudio.enqueueFailure = new Error('flush failed')
  await flushFailurePlayer.stop()
  assert.equal(flushFailureAudio.closed, true)

  const stopFailurePlayer = new WebRadioPlayer(speaker)
  await stopFailurePlayer.start({ url: 'https://radio.example.test/stream' })
  const stopFailureAudio = getAudioOutInstances()[1]
  stopFailureAudio.stopFailure = new Error('stop failed')
  await assert.rejects(stopFailurePlayer.stop(), /stop failed/)
  assert.equal(stopFailureAudio.closed, true)
})

test('WebRadioPlayer stop cancels reconnect and is idempotent', async () => {
  const { default: WebRadioPlayer } = (await import(
    '../platforms/m5stackchan-cores3/web-radio-player.js'
  )) as WebRadioModule
  const player = new WebRadioPlayer(speaker)
  await player.start({ url: 'https://radio.example.test/stream' })
  getMP3StreamerInstances()[0].options.onDone?.()
  player.stop()
  player.stop()
  Timer.advance(30_000)
  assert.equal(getMP3StreamerInstances().length, 1)
  await tick()
  assert.equal(getAudioOutInstances()[0].closed, true)
  assert.equal(player.state, 'idle')
})

test('WebRadioPlayer validates volume, scheme, and sample rate', async () => {
  const { default: WebRadioPlayer } = (await import(
    '../platforms/m5stackchan-cores3/web-radio-player.js'
  )) as WebRadioModule
  const player = new WebRadioPlayer(speaker)
  await assert.rejects(player.start({ url: 'ftp://radio.example.test/stream' }), /HTTP and HTTPS/)
  await assert.rejects(player.start({ url: 'https://radio.example.test/stream', volume: 2 }), /between 0 and 1/)
  await assert.rejects(player.start({ url: 'https://radio.example.test/stream', sampleRate: 22050 }), /44100/)
})

test('WebRadioPlayer limits runtime volume changes to the safe maximum', async () => {
  const { default: WebRadioPlayer } = (await import(
    '../platforms/m5stackchan-cores3/web-radio-player.js'
  )) as WebRadioModule
  const player = new WebRadioPlayer(speaker)
  await player.start({ url: 'https://radio.example.test/stream', volume: 0.01 })
  const audio = getAudioOutInstances()[0]

  assert.equal(audio.enqueued[0].value, 3)
  player.setVolume(0.5)
  assert.equal(audio.enqueued.at(-1)?.value, Math.round(0.2 * 256))
})

test('a stale media handle cannot stop its replacement and foreground audio waits for retirement', async () => {
  const { default: MediaPlayer } = await import('../platforms/m5stackchan-cores3/media-player.js')
  const { createVoiceScope, deferred } = await import('../../voice/scope.js')
  const { bindAudioRuntime } = await import('../../voice/runtime.js')
  const { mono, createPcmSink, pcmMedia } = await import('../../voice/media.js')
  const sink = createPcmSink(mono(24000), () => {})
  let claims = 0
  let pendingBackground: ReturnType<typeof deferred<() => void>> | undefined
  const runtime = bindAudioRuntime(
    {
      acquireExclusive: (background) => {
        if (background && pendingBackground) return pendingBackground.promise
        claims++
        return () => {
          claims--
        }
      },
    },
    () => {
      throw new Error('unexpected capture')
    },
    (_formats, { budget }) => ({
      output: {
        ...sink,
        budget,
        begin: () => sink,
        async finish(outputId) {
          return { outputId, generation: 0, state: 'played', position: { basis: 'unknown' } }
        },
        async fence() {
          return []
        },
      },
      media: pcmMedia,
      setVolume() {},
      async close() {},
    }),
  )
  const player = new MediaPlayer(() => runtime.speaker)
  const old = await player.open({ mode: 'finite', url: 'http://one.test/episode' }, createVoiceScope())
  await old.pause()
  await old.seek(3)
  await old.resume()
  const replacement = await player.open({ mode: 'live', url: 'http://two.test/live' }, createVoiceScope())
  assert.equal('seek' in replacement, false)
  assert.equal(await old.done, 'stopped')
  await old.stop()
  assert.equal(replacement.state, 'buffering')
  const workerStopped = deferred<void>()
  const stream = getMP3StreamerInstances().at(-1)
  assert.ok(stream)
  stream.close = () => workerStopped.promise
  let claimed = false
  const claim = runtime
    .acquirePlayback(runtime.speaker, [mono(24000)], {
      ...createVoiceScope(),
      budget: { maxBufferedMs: 250, maxBufferedBytes: 24576 },
    })
    .then((lease) => {
      claimed = true
      return lease
    })
  await tick()
  assert.equal(claimed, false)
  workerStopped.resolve()
  assert.equal(await replacement.done, 'stopped')
  const foreground = await claim
  assert.equal(claims, 1)
  await foreground.close()
  assert.equal(claims, 0)

  pendingBackground = deferred()
  const connecting = player.open({ mode: 'live', url: 'https://radio.test/' }, createVoiceScope())
  await tick()
  const priority = runtime.acquirePlayback(runtime.speaker, [mono(24000)], {
    ...createVoiceScope(),
    budget: { maxBufferedMs: 250, maxBufferedBytes: 24576 },
  })
  pendingBackground.resolve(() => {})
  const cancelled = await connecting
  assert.equal(await cancelled.done, 'stopped')
  const successor = await priority
  await successor.close()
  assert.equal(claims, 0)
})

test('permanent media failure rejects done after the worker closes', async () => {
  const { default: MediaPlayer } = await import('../platforms/m5stackchan-cores3/media-player.js')
  const { createVoiceScope, deferred } = await import('../../voice/scope.js')
  const player = new MediaPlayer(speaker)
  const media = await player.open({ mode: 'finite', url: 'http://episodes.test/one' }, createVoiceScope())
  const worker = getMP3StreamerInstances()[0]
  const released = deferred<void>()
  worker.close = () => released.promise
  worker.options.onError?.('network lost')
  assert.equal(media.state, 'error')
  let failed = false
  const done = assert.rejects(media.done, /network lost/).then(() => {
    failed = true
  })
  await tick()
  assert.equal(failed, false)
  released.resolve()
  await done
})
