import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { beforeEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { getAudioOutInstances, resetAudioOut, setAudioOutConstructorFailure } from '../../testing/fakes/audio-out.js'
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
  writeAliasPackage(modulesRoot, 'web-radio-audio-out', resolve(modulesRoot, 'testing/fakes/audio-out.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackage(modulesRoot, 'pcm-resampler', resolve(modulesRoot, 'testing/fakes/pcm-resampler.js'), {
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

test('WebRadio bundles the CA certificate required by supported HTTPS streams', () => {
  const manifest = JSON.parse(readFileSync('host/modules/audio/manifest.json', 'utf8')) as {
    data: { '*': string[] }
  }

  assert.ok(manifest.data['*'].includes('$(MODULES)/crypt/data/ca176'))
})

test('App composes the WebRadio module constructor without unwrapping a default export', () => {
  const compose = readFileSync('host/app/compose.ts', 'utf8')

  assert.match(compose, /new \(Modules\.importNow\('web-radio-player'\) as WebRadioPlayerConstructor\)\(\)/)
  assert.doesNotMatch(compose, /Modules\.importNow\('web-radio-player'\)[^\n]*\.default/)
})

test('CoreS3 WebRadio prebuffers enough compressed and decoded MP3 data to cover network stalls', () => {
  const streamer = readFileSync('host/modules/audio/platforms/m5stackchan-cores3/buffered-mp3streamer.js', 'utf8')

  assert.match(streamer, /const TARGET_BUFFER_FRAMES = 32/)
  assert.match(streamer, /import MP3 from 'esp32-mp3-decoder'/)
  assert.match(streamer, /#targetSamplesQueued = MP3_MAX_SAMPLES_PER_FRAME \* TARGET_BUFFER_FRAMES/)
  assert.doesNotMatch(streamer, /HalfSampleRate|HALFSAMPLERATE/)
  assert.match(streamer, /const READ_BUFFER_BYTES = 65536/)
  assert.match(streamer, /const READ_REFILL_THRESHOLD_BYTES = 16 \* 1024/)
  assert.match(streamer, /const START_BUFFER_BYTES = 160 \* 1024/)
  assert.match(streamer, /const RECOVERY_BUFFER_BYTES = 64 \* 1024/)
  assert.match(
    streamer,
    /function createSharedByteBuffer\(byteLength\) \{\s+return new Uint8Array\(new SharedArrayBuffer\(byteLength\)\)/,
  )
  assert.match(streamer, /createSharedByteBuffer\(READ_BUFFER_BYTES\)/)
  assert.match(streamer, /new SharedByteRing\(options\.input\.data, options\.input\.state\)/)
  assert.match(streamer, /this\.#input\.readableView\(available\)/)
  assert.match(streamer, /this\.#input\.advanceRead\(source\.byteLength\)/)
  assert.match(streamer, /#consumeReadBuffer\(byteLength\)/)
  assert.match(streamer, /#readBuffer = this\.#mp3 = undefined/)
  assert.doesNotMatch(streamer, /readBuffer\.copyWithin\(0, consumed/)
  assert.doesNotMatch(streamer, /options\.http|\.request\(/)
})

test('CoreS3 WebRadio forwards worker-resampled PCM into the onWritable ECMA-419 AudioOut', () => {
  const output = readFileSync('host/modules/audio/platforms/m5stackchan-cores3/web-radio-audio-out.ts', 'utf8')

  assert.match(output, /from 'embedded:io\/audio\/out'/)
  assert.doesNotMatch(output, /from 'pins\/audioout'/)
  assert.match(output, /const OUTPUT_SAMPLE_RATE = 24000/)
  assert.match(output, /onWritable: \(size\) => this\.#onWritable\(size\)/)
  assert.doesNotMatch(output, /\.Async/)
  assert.doesNotMatch(output, /callback\?: \(error:/)
  assert.match(output, /this\.#audio\.volume = 0/)
  assert.doesNotMatch(output, /from 'pcm-resampler'|resamplePCM16Mono|#queue|QueuedWrite/)
  assert.doesNotMatch(output, /RawSamples requires|recyclable/)
  assert.match(output, /this\.#writableBytes = size\s+this\.#drainWritable\(\)/)
  assert.match(output, /output\.readableView\(this\.#writableBytes\)/)
  assert.match(output, /Atomics\.add\(completion, 0, use\)/)
  assert.match(output, /if \(this\.#started\) this\.#drainWritable\(\)/)
  assert.doesNotMatch(output, /web-radio-audio-buffer/)
})

test('CoreS3 WebRadio receives into a shared ring and decodes MP3 on a Core 1 worker', () => {
  const proxy = readFileSync('host/modules/audio/platforms/m5stackchan-cores3/worker-mp3streamer.js', 'utf8')
  const worker = readFileSync('host/modules/audio/platforms/m5stackchan-cores3/web-radio-stream-worker.js', 'utf8')
  const manifest = readFileSync('host/modules/audio/manifest.json', 'utf8')
  const decoder = readFileSync('host/modules/audio/platforms/m5stackchan-cores3/esp32-mp3-decoder.c', 'utf8')
  const decoderProxy = readFileSync('host/modules/audio/platforms/m5stackchan-cores3/esp32-mp3-decoder.js', 'utf8')

  assert.match(proxy, /new Worker\('web-radio-stream-worker'/)
  assert.match(proxy, /core: 1/)
  assert.match(proxy, /nativeStack: 10 \* 1024/)
  assert.match(proxy, /const COMPRESSED_RING_BYTES = 512 \* 1024/)
  assert.match(proxy, /const PCM_RING_BYTES = 64 \* 1024/)
  assert.match(proxy, /SharedByteRing\.allocate\(COMPRESSED_RING_BYTES\)/)
  assert.match(proxy, /SharedByteRing\.allocate\(PCM_RING_BYTES\)/)
  assert.match(proxy, /attachSharedOutput\(this\.#output, this\.#completion/)
  assert.match(proxy, /request = http\.request\(/)
  assert.match(proxy, /input\.writableView\(request\.readable\)/)
  assert.match(proxy, /input\.advanceWrite\(target\.byteLength\)/)
  assert.match(proxy, /import Timer from 'timer'/)
  assert.match(proxy, /this\.#networkReconnectTimer = Timer\.set\(\(\) => this\.#openNetwork\(\), delay\)/)
  assert.doesNotMatch(proxy, /postMessage\(\{ id: 'end'/)
  assert.match(proxy, /this\.#worker\?\.postMessage\(\{ id: 'close' \}\)/)
  assert.doesNotMatch(proxy, /postMessage\(\{ id: 'close' \}\)\s+this\.#worker\?\.terminate\(\)/)
  assert.match(proxy, /new Int32Array\(new SharedArrayBuffer\(4\)\)/)
  assert.match(proxy, /outputSampleRate: this\.#audio\.sampleRate/)
  assert.doesNotMatch(proxy, /postMessage\(\{ id: 'played'/)
  assert.doesNotMatch(proxy, /message\.buffer/)
  assert.match(proxy, /case 'output':\s+this\.#audio\.pumpSharedOutput\(\)/)
  assert.match(worker, /from 'buffered-mp3streamer-core'/)
  assert.match(worker, /from 'pcm-resampler'/)
  assert.match(worker, /from 'web-radio-byte-ring'/)
  assert.match(worker, /input: message\.input/)
  assert.match(worker, /streamer\?\.pump\(\)/)
  assert.match(worker, /const FRAMES_PER_OUTPUT_BATCH = 4/)
  assert.match(worker, /const MAX_COMPLETION_CALLBACKS_PER_PUMP = 8/)
  assert.match(worker, /new SharedByteRing\(output\.data, output\.state\)/)
  assert.match(worker, /this\.#output\.writableBytes < maximumOutputCount \* 2/)
  assert.match(worker, /resamplePCM16Mono\(/)
  assert.match(worker, /self\.postMessage\(\{ id: 'output' \}\)/)
  assert.match(worker, /self\.postMessage\(\{ id: 'closed' \}\)[\s\S]+self\.close\(\)/)
  assert.doesNotMatch(worker, /postMessage\(\{ id: 'pcm'/)
  assert.match(worker, /Atomics\.load\(this\.#completion, 0\)/)
  assert.match(worker, /let callbacks = MAX_COMPLETION_CALLBACKS_PER_PUMP/)
  assert.doesNotMatch(worker, /\.slice\(|new Uint8Array\(value\)/)
  assert.doesNotMatch(worker, /web-radio-worker-(?:decode|sink)/)
  assert.match(manifest, /modules\/base\/worker\/manifest\.json/)
  assert.match(manifest, /"buffered-mp3streamer": "\.\/platforms\/m5stackchan-cores3\/worker-mp3streamer"/)
  assert.match(manifest, /"buffered-mp3streamer-core": "\.\/platforms\/m5stackchan-cores3\/buffered-mp3streamer"/)
  assert.match(manifest, /"esp32-mp3-decoder": "\.\/platforms\/m5stackchan-cores3\/esp32-mp3-decoder"/)
  assert.match(manifest, /"SDKCONFIGPATH \?=": "\.\/platforms\/m5stackchan-cores3\/sdkconfig"/)
  assert.match(manifest, /"name": "esp_audio_codec"/)
  assert.match(manifest, /"version": "~2\.5\.0"/)
  assert.doesNotMatch(manifest, /libmad-optimized|mp3-half-sample-rate/)
  assert.match(manifest, /"web-radio-byte-ring": "\.\/platforms\/m5stackchan-cores3\/shared-byte-ring"/)
  assert.match(decoder, /esp_mp3_dec_open\(NULL, 0, &decoder->handle\)/)
  assert.match(decoder, /esp_mp3_dec_decode\(decoder->handle, &raw, &frame, &info\)/)
  assert.match(
    decoder,
    /const uint32_t preferred = \(bytes >= MP3_RESERVOIR_BYTES\) \? MALLOC_CAP_SPIRAM : MALLOC_CAP_INTERNAL/,
  )
  assert.match(decoder, /heap_caps_calloc\(count, size, preferred \| MALLOC_CAP_8BIT\)/)
  assert.match(decoder, /heap_caps_calloc\(count, size, fallback \| MALLOC_CAP_8BIT\)/)
  assert.match(decoder, /heap_caps_malloc\(MP3_PCM_SCRATCH_BYTES, MALLOC_CAP_SPIRAM \| MALLOC_CAP_8BIT\)/)
  assert.match(decoder, /mixed = \(int32_t\)source\[0\] \+ source\[1\]/)
  assert.doesNotMatch(decoder, /codec_log_allocations|gTrackCodecAllocations|web-radio-decoder-memory/)
  assert.match(decoderProxy, /const MP3_MAX_FRAME_BYTES = 2048/)
  assert.match(decoderProxy, /if \(length > MP3_MAX_FRAME_BYTES\) return/)
})

test('WebRadioPlayer parses HTTPS URL, limits volume, and controls AudioOut readiness', async () => {
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
  const player = new WebRadioPlayer()
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
  assert.equal(getMP3StreamerInstances().length, 2)
})

test('WebRadioPlayer reports transport failures without retry when reconnect is disabled', async () => {
  const { default: WebRadioPlayer } = (await import(
    '../platforms/m5stackchan-cores3/web-radio-player.js'
  )) as WebRadioModule
  const states: string[] = []
  const player = new WebRadioPlayer()
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
  const player = new WebRadioPlayer()

  await player.start({ url: 'https://radio.example.test/stream' })
  assert.equal(player.state, 'retrying')
  assert.equal(getAudioOutInstances().length, 0)

  setAudioOutConstructorFailure(undefined)
  Timer.advance(1000)
  assert.equal(getAudioOutInstances().length, 1)
  assert.equal(getMP3StreamerInstances().length, 1)
})

test('WebRadioPlayer closes AudioOut and retries synchronous streamer construction failures', async () => {
  const { default: WebRadioPlayer } = (await import(
    '../platforms/m5stackchan-cores3/web-radio-player.js'
  )) as WebRadioModule
  setMP3StreamerConstructorFailure(new Error('streamer allocation failed'))
  const player = new WebRadioPlayer()

  await player.start({ url: 'https://radio.example.test/stream' })
  assert.equal(player.state, 'retrying')
  assert.equal(getAudioOutInstances()[0].closed, true)

  setMP3StreamerConstructorFailure(undefined)
  Timer.advance(1000)
  assert.equal(getMP3StreamerInstances().length, 1)
})

test('WebRadioPlayer closes AudioOut when flush or stop throws', async () => {
  const { default: WebRadioPlayer } = (await import(
    '../platforms/m5stackchan-cores3/web-radio-player.js'
  )) as WebRadioModule
  const flushFailurePlayer = new WebRadioPlayer()
  await flushFailurePlayer.start({ url: 'https://radio.example.test/stream' })
  const flushFailureAudio = getAudioOutInstances()[0]
  flushFailureAudio.enqueueFailure = new Error('flush failed')
  flushFailurePlayer.stop()
  assert.equal(flushFailureAudio.closed, true)

  const stopFailurePlayer = new WebRadioPlayer()
  await stopFailurePlayer.start({ url: 'https://radio.example.test/stream' })
  const stopFailureAudio = getAudioOutInstances()[1]
  stopFailureAudio.stopFailure = new Error('stop failed')
  stopFailurePlayer.stop()
  assert.equal(stopFailureAudio.closed, true)
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

test('WebRadioPlayer limits runtime volume changes to the safe maximum', async () => {
  const { default: WebRadioPlayer } = (await import(
    '../platforms/m5stackchan-cores3/web-radio-player.js'
  )) as WebRadioModule
  const player = new WebRadioPlayer()
  await player.start({ url: 'https://radio.example.test/stream', volume: 0.01 })
  const audio = getAudioOutInstances()[0]

  assert.equal(audio.enqueued[0].value, 3)
  player.setVolume(0.5)
  assert.equal(audio.enqueued.at(-1)?.value, Math.round(0.2 * 256))
})
