import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import type { BorrowedAudioBuffer, OwnedAudioBuffer } from '../../modules/audio/audio-buffer.js'
import { writeAliasPackage, writeAliasPackageSubpath } from '../../modules/testing/node-alias-package.js'

import { installRuntimeTestAliases } from './runtime-test-aliases.js'

type RuntimeAudioModule = typeof import('../runtime-audio.js')

function installBareSpecifierPackages(): void {
  installRuntimeTestAliases()
  const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  writeAliasPackage(hostRoot, 'operation-queue', resolve(hostRoot, 'app/operation-queue.js'))
  writeAliasPackage(hostRoot, 'recording-wave', resolve(hostRoot, 'modules/audio/recording-wave.js'))
  writeAliasPackageSubpath(
    resolve(hostRoot, 'modules'),
    'stackchan-contracts',
    'audio-recording',
    resolve(hostRoot, '../contracts/audio-recording.js'),
  )
  writeAliasPackage(hostRoot, 'stackchan-util', resolve(hostRoot, 'modules/util/stackchan-util.js'))
  writeAliasPackage(hostRoot, 'timer', resolve(hostRoot, 'modules/testing/fakes/timer.js'), { hasDefaultExport: true })
  writeAliasPackage(hostRoot, 'mac-address', resolve(hostRoot, 'modules/util/sim/mac-address.js'), {
    hasDefaultExport: true,
  })
}

function fakeTTS() {
  return {
    stream: (_text: string, _volume?: number, callback?: (error?: unknown) => void) => callback?.(),
    streamKoe: (_koe: string, _volume?: number, callback?: (error?: unknown) => void) => callback?.(),
  }
}

test('SDK recording replays native WAV or actual browser encoding with its volume on the shared output queue', async () => {
  installBareSpecifierPackages()
  const { StackchanRuntimeAudio } = await import('../runtime-audio.js')
  const { createRecordingWave } = await import('../../modules/audio/recording-wave.js')
  for (const simulated of [false, true]) {
    const native = createRecordingWave({ sampleRate: 16000, channels: 1, bitsPerSample: 16 }, 10).buffer
    const buffer = simulated
      ? Object.assign(Uint8Array.of(1, 2, 3).buffer, { mimeType: 'audio/webm;codecs=opus', filename: 'recording.webm' })
      : native
    const order: string[] = []
    let requestedDuration: number | undefined
    let finishSpeech: (() => void) | undefined
    const runtime = new StackchanRuntimeAudio({
      simulated,
      tts: {
        stream(_text, _volume, done) {
          order.push('speech')
          finishSpeech = () => done?.()
        },
      },
      microphone: {
        async record(duration) {
          requestedDuration = duration
          return buffer as OwnedAudioBuffer
        },
        stop() {},
      },
      speaker: {
        async tone() {},
        async play(data, volume) {
          assert.equal(data, buffer)
          assert.equal(volume, 0.25)
          order.push('play')
          return true
        },
      },
    })
    const app = runtime.createAppSession()
    const recorded = await app.record({ durationMs: 10 })
    assert.equal(requestedDuration, 10)
    assert.equal(recorded.mimeType, simulated ? 'audio/webm;codecs=opus' : 'audio/wav')
    const speech = app.say('hello')
    const playback = app.play(recorded, { volume: 0.25 })
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.deepEqual(order, ['speech'], 'buffer playback waits for speech to release output')
    finishSpeech?.()
    await Promise.all([speech, playback])
    assert.deepEqual(order, ['speech', 'play'])
    await app.close()
    await runtime.close()
  }
})

test('SDK input availability and invalid arguments never invent successful recording or playback', async () => {
  installBareSpecifierPackages()
  const { StackchanRuntimeAudio } = await import('../runtime-audio.js')
  let available = false
  let starts = 0
  const runtime = new StackchanRuntimeAudio({
    tts: fakeTTS(),
    microphone: {
      get available() {
        return available
      },
      async record() {
        starts++
        return new ArrayBuffer(44) as OwnedAudioBuffer
      },
      stop() {},
    },
    speaker: {
      async tone() {},
      async play() {
        starts++
        return false
      },
    },
  })
  const app = runtime.createAppSession()
  assert.equal(runtime.audioStatus('recording').availability, 'unavailable')
  await assert.rejects(app.record(), { code: 'UNSUPPORTED' })
  available = true
  assert.equal(runtime.audioStatus('recording').availability, 'native')
  await assert.rejects(app.record({ durationMs: NaN }), { code: 'INVALID_ARGUMENT' })
  await assert.rejects(app.play({ data: new ArrayBuffer(4), mimeType: 'audio/webm' }), { code: 'UNSUPPORTED' })
  await assert.rejects(app.play({ data: new ArrayBuffer(0), mimeType: 'audio/wav' }), { code: 'INVALID_ARGUMENT' })
  assert.equal(starts, 0)
  await assert.rejects(app.record(), { code: 'IO' })
  await assert.rejects(app.play({ data: new ArrayBuffer(4), mimeType: 'audio/wav' }), { code: 'IO' })
  await app.close()
  await runtime.close()
  const missing = new StackchanRuntimeAudio({ tts: fakeTTS() })
  await assert.rejects(missing.createAppSession().play({ data: new ArrayBuffer(4), mimeType: 'audio/wav' }), {
    code: 'UNSUPPORTED',
  })
  await missing.close()
})

test('normal recording completion with failed physical release faults input and reaches app close', async () => {
  installBareSpecifierPackages()
  const { StackchanRuntimeAudio } = await import('../runtime-audio.js')
  const { StackchanError } = await import('../../../sdk/errors.js')
  const failure = new StackchanError('IO', 'Input was not released')
  let releaseFailure: typeof failure | undefined
  let starts = 0
  const runtime = new StackchanRuntimeAudio({
    tts: fakeTTS(),
    microphone: {
      get releaseFailure() {
        return releaseFailure
      },
      async record() {
        starts++
        releaseFailure = failure
        throw failure
      },
      stop() {
        if (releaseFailure) throw releaseFailure
      },
    },
  })
  const app = runtime.createAppSession()
  const first = assert.rejects(app.record(), (error) => error === failure)
  const second = assert.rejects(app.record(), { code: 'IO' })
  await Promise.all([first, second])
  assert.equal(starts, 1)
  assert.equal(runtime.audioStatus('recording').availability, 'unavailable')
  assert.equal(
    runtime.audioStatus('speech').availability,
    'unavailable',
    'availability agrees with app audio fault policy',
  )
  await assert.rejects(app.close(), (error) => error === failure)
  await assert.rejects(runtime.close())
})

test('audio capabilities track backend availability without starting a playback', async () => {
  installBareSpecifierPackages()
  const { StackchanRuntimeAudio } = await import('../runtime-audio.js')
  let available = false
  const probe = () => available
  const runtime = new StackchanRuntimeAudio({
    tts: { ...fakeTTS(), available: probe },
    clipPlayer: { ...fakeTTS(), available: probe },
    speaker: { available: probe, tone: async () => {}, play: async () => true },
    simulated: true,
  })
  for (const kind of ['speech', 'clips', 'tone'] as const)
    assert.equal(runtime.audioStatus(kind).availability, 'unavailable')
  available = true
  for (const kind of ['speech', 'clips', 'tone'] as const)
    assert.equal(runtime.audioStatus(kind).availability, 'simulated')
  await runtime.close()
  assert.equal(runtime.audioStatus('tone').availability, 'unavailable')
})

test('V2 audio keeps text and resource playback separate while sharing one output queue', async () => {
  installBareSpecifierPackages()
  const { StackchanRuntimeAudio } = (await import('../runtime-audio.js')) as RuntimeAudioModule
  const calls: string[] = []
  const runtime = new StackchanRuntimeAudio({
    tts: {
      stream(text, _volume, callback) {
        calls.push(`speech:${text}`)
        callback?.()
      },
    },
    clipPlayer: {
      stream(name, _volume, callback) {
        calls.push(`clip:${name}`)
        callback?.()
      },
    },
    ttsKind: 'speech',
  })
  await Promise.all([runtime.say('こんにちは'), runtime.playClip('hello')])
  assert.deepEqual(calls, ['speech:こんにちは', 'clip:hello'])
  assert.equal(runtime.audioStatus('speech').availability, 'native')
  assert.equal(runtime.audioStatus('clips').availability, 'native')
  await assert.rejects(runtime.playClip('../hello'), { code: 'INVALID_ARGUMENT' })
  await assert.rejects(runtime.say('hello', { volume: Number.NaN }), { code: 'INVALID_ARGUMENT' })
  const local = new StackchanRuntimeAudio({ tts: fakeTTS(), ttsKind: 'clips' })
  await assert.rejects(local.say('こんにちは'), { code: 'UNSUPPORTED' })
  await local.playClip('hello')
  await runtime.close()
  await local.close()
})

test('StackchanRuntimeAudio forwards singing koe to providers that support it', async () => {
  installBareSpecifierPackages()
  const { StackchanRuntimeAudio } = (await import('../runtime-audio.js')) as RuntimeAudioModule
  let received: { koe: string; volume?: number } | undefined
  const runtime = new StackchanRuntimeAudio({
    tts: {
      stream: (_text, _volume, callback) => callback?.(),
      streamKoe: (koe, volume, callback) => {
        received = { koe, volume }
        callback?.()
      },
    },
  })

  const app = runtime.createAppSession()
  const result = await app.sing(120, [['C4', 1, 'き']], { volume: 0.25 })

  assert.deepEqual(received, { koe: '#C4,500ki', volume: 0.25 })
  assert.equal(result, undefined)
  assert.equal(runtime.audioStatus('singing').availability, 'native')
  await assert.rejects(app.sing(120, [['R', 1, 'あ']]), { code: 'INVALID_ARGUMENT' })
  const release = runtime.reserveStream(false, true)
  await assert.rejects(app.sing(120, [['C4', 1, 'き']]), { code: 'BUSY' })
  release()
  await app.close()
  await assert.rejects(app.sing(120, [['C4', 1, 'き']]), { code: 'CLOSED' })
  await runtime.close()
})

test('StackchanRuntimeAudio reports singing as unsupported for other TTS providers', async () => {
  installBareSpecifierPackages()
  const { StackchanRuntimeAudio } = (await import('../runtime-audio.js')) as RuntimeAudioModule
  const testGlobal = globalThis as typeof globalThis & { trace?: (message: string) => void }
  testGlobal.trace = () => {}
  const runtime = new StackchanRuntimeAudio({
    tts: { stream: (_text, _volume, callback) => callback?.() },
  })

  try {
    assert.equal(runtime.audioStatus('singing').availability, 'unavailable')
    await assert.rejects(runtime.createAppSession().sing(120, [['C4', 1, 'き']]), { code: 'UNSUPPORTED' })
    await runtime.close()
  } finally {
    delete testGlobal.trace
  }
})

test('StackchanRuntimeAudio forwards borrowed buffers to the target player', async () => {
  installBareSpecifierPackages()
  const { StackchanRuntimeAudio } = (await import('../runtime-audio.js')) as RuntimeAudioModule
  const buffer = new ArrayBuffer(4) as BorrowedAudioBuffer
  let forwarded: BorrowedAudioBuffer | undefined
  const speaker = {
    tone: async () => {},
    play: async (next: BorrowedAudioBuffer) => {
      forwarded = next
      return true
    },
  }

  const runtime = new StackchanRuntimeAudio({ tts: fakeTTS(), speaker })

  assert.equal(await runtime.play({ data: buffer, mimeType: 'audio/wav' }), undefined)
  assert.equal(forwarded, buffer)
})

test('SDK playback rejects missing output and failed confirmation', async () => {
  installBareSpecifierPackages()
  const { StackchanRuntimeAudio } = (await import('../runtime-audio.js')) as RuntimeAudioModule
  const buffer = new ArrayBuffer(4) as BorrowedAudioBuffer
  const runtimeWithoutSpeaker = new StackchanRuntimeAudio({ tts: fakeTTS() })
  const runtimeUnsupported = new StackchanRuntimeAudio({
    tts: fakeTTS(),
    speaker: {
      tone: async () => {},
      play: async () => false,
    },
  })

  await assert.rejects(runtimeWithoutSpeaker.play({ data: buffer, mimeType: 'audio/wav' }), { code: 'UNSUPPORTED' })
  await assert.rejects(runtimeUnsupported.play({ data: buffer, mimeType: 'audio/wav' }), { code: 'IO' })
})

test('StackchanRuntimeAudio close stops the microphone and detaches TTS callbacks', async () => {
  installBareSpecifierPackages()
  const { StackchanRuntimeAudio } = (await import('../runtime-audio.js')) as RuntimeAudioModule
  let stopped = false
  const microphone = {
    recording: false,
    start: () => {},
    stop: () => {
      stopped = true
    },
    record: async () => {
      throw new Error('not used')
    },
  }
  const tts = fakeTTS()
  let mouthOpen = -1

  const runtime = new StackchanRuntimeAudio({ tts, microphone }, { onMouthOpenChanged: (value) => (mouthOpen = value) })
  await runtime.close()

  assert.equal(stopped, true)
  const playbackTTS = tts as { onPlayed?: (volume: number) => void; onDone?: () => void }
  playbackTTS.onPlayed?.(2000)
  playbackTTS.onDone?.()
  assert.equal(mouthOpen, -1)
})

test('StackchanRuntimeAudio close detaches TTS callbacks even when the microphone stop fails', async () => {
  installBareSpecifierPackages()
  const { StackchanRuntimeAudio } = (await import('../runtime-audio.js')) as RuntimeAudioModule
  const microphone = {
    recording: false,
    start: () => {},
    stop: () => {
      throw new Error('stop failure')
    },
    record: async () => {
      throw new Error('not used')
    },
  }
  const tts = fakeTTS()
  let mouthOpen = -1

  const runtime = new StackchanRuntimeAudio({ tts, microphone }, { onMouthOpenChanged: (value) => (mouthOpen = value) })

  await assert.rejects(runtime.close(), /stop failure/)
  const ttsCallbacks = tts as { onPlayed?: (volume: number) => void; onDone?: () => void }
  ttsCallbacks.onPlayed?.(2000)
  ttsCallbacks.onDone?.()
  assert.equal(mouthOpen, -1)
})

test('StackchanRuntimeAudio rejects WebRadio start while TTS is busy', async () => {
  installBareSpecifierPackages()
  const { StackchanRuntimeAudio } = (await import('../runtime-audio.js')) as RuntimeAudioModule
  let complete: ((error?: unknown) => void) | undefined
  let radioStarts = 0
  const runtime = new StackchanRuntimeAudio({
    tts: { stream: (_text, _volume, callback) => (complete = callback) },
    webRadio: {
      state: 'idle',
      start: async () => {
        radioStarts += 1
      },
      stop: () => {},
      setVolume: () => {},
    },
  })

  const speech = runtime.say('hello')
  assert.throws(() => runtime.reserveStream(false, true), { code: 'BUSY' })
  assert.equal(radioStarts, 0)
  complete?.()
  await speech
  const release = runtime.reserveStream(false, true)
  await runtime.streamingRadio?.start({ url: 'https://example.test/radio.mp3' })
  release()
  assert.equal(radioStarts, 1)
})

test('StackchanRuntimeAudio serializes playback and stays busy while operations are queued', async () => {
  installBareSpecifierPackages()
  const { StackchanRuntimeAudio } = (await import('../runtime-audio.js')) as RuntimeAudioModule
  let finishTone: (() => void) | undefined
  let finishPlayback: (() => void) | undefined
  let radioStarts = 0
  const runtime = new StackchanRuntimeAudio({
    tts: fakeTTS(),
    webRadio: {
      state: 'idle',
      start: async () => {
        radioStarts += 1
      },
      stop: () => {},
      setVolume: () => {},
    },
    speaker: {
      tone: () => new Promise<void>((resolve) => (finishTone = resolve)),
      play: () => new Promise<boolean>((resolve) => (finishPlayback = () => resolve(true))),
    },
  })

  const tone = runtime.tone(440, { durationMs: 20 })
  const playback = runtime.play({ data: new ArrayBuffer(2) as BorrowedAudioBuffer, mimeType: 'audio/wav' })
  assert.equal(finishPlayback, undefined, 'queued playback must not open a second output')
  assert.throws(() => runtime.reserveStream(false, true), { code: 'BUSY' })

  finishTone?.()
  await tone
  assert.throws(() => runtime.reserveStream(false, true), { code: 'BUSY' })

  finishPlayback?.()
  await playback
  const release = runtime.reserveStream(false, true)
  await runtime.streamingRadio?.start({ url: 'https://example.test/radio.mp3' })
  release()
  assert.equal(radioStarts, 1)
})

test('StackchanRuntimeAudio close stops WebRadio', async () => {
  installBareSpecifierPackages()
  const { StackchanRuntimeAudio } = (await import('../runtime-audio.js')) as RuntimeAudioModule
  let stopped = false
  const runtime = new StackchanRuntimeAudio({
    tts: fakeTTS(),
    webRadio: {
      state: 'playing',
      start: async () => {},
      stop: () => {
        stopped = true
      },
      setVolume: () => {},
    },
  })
  await runtime.close()
  assert.equal(stopped, true)
})

test('close cancels in-flight speech, rejects queued tone, and suppresses late completion', async () => {
  installBareSpecifierPackages()
  const { StackchanRuntimeAudio } = (await import('../runtime-audio.js')) as RuntimeAudioModule
  ;(globalThis as typeof globalThis & { trace: () => void }).trace = () => {}
  let late: ((error?: unknown) => void) | undefined
  let cancelled = 0
  let tones = 0
  const runtime = new StackchanRuntimeAudio({
    tts: {
      stream(_text, _volume, callback) {
        late = callback
      },
      cancelPlayback() {
        cancelled += 1
        this.cancelPlayback = undefined
      },
    },
    speaker: {
      async tone() {
        tones += 1
      },
      async play() {
        return true
      },
    },
  })
  const speech = assert.rejects(runtime.say('hello'), { code: 'CLOSED' })
  const tone = runtime.tone(440, { durationMs: 100 })
  await runtime.close()
  await assert.rejects(tone, { code: 'CLOSED' })
  await speech
  late?.()
  assert.equal(cancelled, 1)
  assert.equal(tones, 0)
  await assert.rejects(runtime.tone(440, { durationMs: 100 }), { code: 'CLOSED' })
})

test('recording cancellation stays within its operation and queued cancellation does not stop active input', async () => {
  installBareSpecifierPackages()
  const { StackchanRuntimeAudio } = await import('../runtime-audio.js')
  const { CancellationSource } = await import('../cancellation.js')
  let starts = 0
  let stops = 0
  let complete: (buffer: OwnedAudioBuffer) => void
  const runtime = new StackchanRuntimeAudio({
    tts: fakeTTS(),
    microphone: {
      record: () => {
        starts++
        return new Promise<OwnedAudioBuffer>((resolve) => {
          complete = resolve
        })
      },
      stop: () => {
        stops++
      },
    },
  })
  const active = new CancellationSource()
  const pending = new CancellationSource()
  const first = runtime.record({ durationMs: 10, signal: active.signal })
  const second = runtime.record({ durationMs: 10, signal: pending.signal })
  pending.cancel()
  await assert.rejects(second, { code: 'CANCELLED' })
  assert.equal(starts, 1)
  assert.equal(stops, 0)
  active.cancel()
  await assert.rejects(first, { code: 'CANCELLED' })
  assert.equal(stops, 1)
  complete(new ArrayBuffer(0) as OwnedAudioBuffer)
  await assert.rejects(runtime.record({ durationMs: 15_001 }), { code: 'INVALID_ARGUMENT' })
  assert.equal(starts, 1, 'invalid duration never reaches the microphone')
  await runtime.close()
  await assert.rejects(runtime.record({ durationMs: 10 }), { code: 'CLOSED' })
})

test('audio close awaits microphone release and preserves a failed release', async () => {
  installBareSpecifierPackages()
  const { StackchanRuntimeAudio } = await import('../runtime-audio.js')
  for (const method of ['close', 'stop'] as const) {
    let release: () => void
    let started: () => void
    const releasing = new Promise<void>((resolve) => {
      started = resolve
    })
    const microphone = {
      record: async () => new ArrayBuffer(0) as OwnedAudioBuffer,
      stop() {},
      [method]: () => {
        started()
        return new Promise<void>((resolve) => {
          release = resolve
        })
      },
    }
    const runtime = new StackchanRuntimeAudio({ tts: fakeTTS(), microphone })
    let closed = false
    const closing = runtime.close().then(() => {
      closed = true
    })
    await releasing
    assert.equal(closed, false, `${method} completion is part of host shutdown`)
    release()
    await closing
    assert.equal(closed, true)
  }
  const failure = new Error('physical microphone close failed')
  const broken = new StackchanRuntimeAudio({
    tts: fakeTTS(),
    microphone: {
      record: async () => new ArrayBuffer(0) as OwnedAudioBuffer,
      stop() {},
      close: () => Promise.reject(failure),
    },
  })
  await assert.rejects(broken.close(), (error) => error === failure)
  await assert.rejects(broken.record({ durationMs: 10 }), { code: 'CLOSED' })
})

test('a completed provider with failed cleanup cannot hand output to another provider or speaker', async () => {
  installBareSpecifierPackages()
  const { StackchanRuntimeAudio } = await import('../runtime-audio.js')
  const { beginPlaybackSession, PlaybackProvider } = await import('../../modules/audio/tts-playback-session.js')
  let finish!: () => void
  class Speech extends PlaybackProvider {
    stream(_text: string, _volume?: number, callback?: (error?: unknown) => void) {
      const session = beginPlaybackSession(this, callback)
      if (!session) return
      session.addCleanup(() => {
        throw new Error('output did not release')
      })
      finish = session.onDone
    }
  }
  let tones = 0,
    clips = 0
  const runtime = new StackchanRuntimeAudio({
    tts: new Speech(),
    clipPlayer: {
      stream(_text, _volume, callback) {
        clips++
        callback?.()
      },
    },
    speaker: {
      async tone() {
        tones++
      },
      async play() {
        return true
      },
    },
  })
  const speech = assert.rejects(runtime.say('hello'), { code: 'IO', message: 'output did not release' })
  const tone = assert.rejects(runtime.tone(440, { durationMs: 100 }), { code: 'IO' })
  const clip = assert.rejects(runtime.playClip('hello'), { code: 'IO' })
  finish()
  await Promise.all([speech, tone, clip])
  assert.equal(tones, 0)
  assert.equal(clips, 0)
  assert.equal(runtime.audioStatus('tone').availability, 'unavailable')
  await assert.rejects(runtime.close(), { code: 'IO', message: 'output did not release' })
})

test('app audio close waits for its active provider and leaves other sessions and host providers usable', async () => {
  installBareSpecifierPackages()
  const { StackchanRuntimeAudio } = await import('../runtime-audio.js')
  const { beginPlaybackSession, PlaybackProvider } = await import('../../modules/audio/tts-playback-session.js')
  const releases: Array<() => void> = []
  let providerCloses = 0
  class Speech extends PlaybackProvider {
    stream(_text: string, _volume?: number, callback?: (error?: unknown) => void) {
      const session = beginPlaybackSession(this, callback)
      session?.addCleanup(
        () =>
          new Promise<void>((resolve) => {
            releases.push(resolve)
          }),
      )
    }
    close() {
      providerCloses++
      return super.close()
    }
  }
  const runtime = new StackchanRuntimeAudio({ tts: new Speech() })
  const first = runtime.createAppSession()
  const waiting = runtime.createAppSession()
  const speaking = assert.rejects(first.say('active'), { code: 'CLOSED' })
  const queued = assert.rejects(waiting.say('waiting'), { code: 'CLOSED' })
  await new Promise<void>((resolve) => setImmediate(resolve))
  await waiting.close()
  await queued
  assert.equal(releases.length, 0, 'closing a queued app does not cancel another app')
  let closed = false
  const closing = first.close().then(() => {
    closed = true
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(closed, false)
  assert.equal(releases.length, 1)
  releases.shift()?.()
  await Promise.all([closing, speaking])
  assert.equal(providerCloses, 0, 'app close leaves the host provider alive')
  assert.equal(runtime.audioStatus('speech').availability, 'native')
  const next = runtime.createAppSession()
  const successor = assert.rejects(next.say('successor'), { code: 'CLOSED' })
  await new Promise<void>((resolve) => setImmediate(resolve))
  const ending = next.close()
  await new Promise<void>((resolve) => setImmediate(resolve))
  releases.shift()?.()
  await Promise.all([ending, successor])
  await runtime.close()
  assert.equal(providerCloses, 1)
})

test('app close preserves a physical release failure beyond the cancelled command result', async () => {
  installBareSpecifierPackages()
  const { StackchanRuntimeAudio } = await import('../runtime-audio.js')
  const { beginPlaybackSession, PlaybackProvider } = await import('../../modules/audio/tts-playback-session.js')
  class Speech extends PlaybackProvider {
    stream(_text: string, _volume?: number, callback?: (error?: unknown) => void) {
      beginPlaybackSession(this, callback)?.addCleanup(() => {
        throw new Error('audio release failed')
      })
    }
  }
  const runtime = new StackchanRuntimeAudio({ tts: new Speech() })
  const app = runtime.createAppSession()
  const speaking = assert.rejects(app.say('hello'), { code: 'CLOSED' })
  await new Promise<void>((resolve) => setImmediate(resolve))
  await assert.rejects(app.close(), { code: 'IO', message: 'audio release failed' })
  await speaking
  assert.equal(app.pendingCount, 0)
  assert.equal(runtime.audioStatus('speech').availability, 'unavailable')
  await assert.rejects(runtime.createAppSession().say('successor'), { code: 'IO', message: 'audio release failed' })
  await assert.rejects(runtime.close(), { code: 'IO', message: 'audio release failed' })
})

test('closing audio waits for a provider whose cancellation returns asynchronous release', async () => {
  installBareSpecifierPackages()
  const { StackchanRuntimeAudio } = await import('../runtime-audio.js')
  const { beginPlaybackSession, PlaybackProvider } = await import('../../modules/audio/tts-playback-session.js')
  let release!: () => void
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  class Speech extends PlaybackProvider {
    stream(_text: string, _volume?: number, callback?: (error?: unknown) => void) {
      beginPlaybackSession(this, callback)?.addCleanup(() => released)
    }
  }
  const runtime = new StackchanRuntimeAudio({ tts: new Speech() })
  const speaking = assert.rejects(runtime.say('hello'), { code: 'CLOSED' })
  let closed = false
  const closing = runtime.close().then(() => {
    closed = true
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(closed, false)
  release()
  await closing
  await speaking
})

test('stream leases exclude competing recording and playback, then release the same devices', async () => {
  installBareSpecifierPackages()
  const { StackchanRuntimeAudio } = await import('../runtime-audio.js')
  let tones = 0,
    records = 0
  const runtime = new StackchanRuntimeAudio({
    tts: fakeTTS(),
    microphone: {
      async record() {
        records++
        const { createRecordingWave } = await import('../../modules/audio/recording-wave.js')
        return createRecordingWave({ sampleRate: 16000, channels: 1, bitsPerSample: 16 }, 10).buffer as OwnedAudioBuffer
      },
      stop() {},
    },
    speaker: {
      async tone() {
        tones++
      },
      async play() {
        return true
      },
    },
  })
  const release = runtime.reserveStream(true, true)
  await assert.rejects(runtime.record({ durationMs: 10 }), { code: 'BUSY' })
  await assert.rejects(runtime.tone(440, { durationMs: 10 }), { code: 'BUSY' })
  await assert.rejects(runtime.say('hello'), { code: 'BUSY' })
  assert.throws(() => runtime.reserveStream(false, true), { code: 'BUSY' })
  assert.equal(records + tones, 0)
  release()
  release()
  await runtime.record({ durationMs: 10 })
  await runtime.tone(440, { durationMs: 10 })
  assert.equal(records + tones, 2)
  await runtime.close()
})

test('a failed streaming device release prevents later audio reuse', async () => {
  installBareSpecifierPackages()
  const { StackchanRuntimeAudio } = await import('../runtime-audio.js')
  const runtime = new StackchanRuntimeAudio({ tts: fakeTTS() })
  const release = runtime.reserveStream(true, true)
  runtime.failStream(new Error('native close failed'))
  release()
  assert.throws(() => runtime.reserveStream(true, true), { code: 'IO' })
  await assert.rejects(runtime.say('hello'), { code: 'IO' })
  await runtime.close()
})
