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
  writeAliasPackageSubpath(hostRoot, 'stackchan', 'errors', resolve(hostRoot, '../sdk/errors.js'))
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
  await Promise.all([runtime.speak('こんにちは'), runtime.playClip('hello')])
  assert.deepEqual(calls, ['speech:こんにちは', 'clip:hello'])
  assert.equal(runtime.audioStatus('speech').availability, 'native')
  assert.equal(runtime.audioStatus('clips').availability, 'native')
  await assert.rejects(runtime.playClip('../hello'), { code: 'INVALID_ARGUMENT' })
  await assert.rejects(runtime.speak('hello', { volume: Number.NaN }), { code: 'INVALID_ARGUMENT' })
  const local = new StackchanRuntimeAudio({ tts: fakeTTS(), ttsKind: 'clips' })
  await assert.rejects(local.speak('こんにちは'), { code: 'UNSUPPORTED' })
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

  const result = await runtime.sing('#C4,500ki', 0.25)

  assert.deepEqual(received, { koe: '#C4,500ki', volume: 0.25 })
  assert.deepEqual(result, { success: true, value: '#C4,500ki' })
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
    const result = await runtime.sing('#C4,500ki')
    assert.equal(result.success, false)
    if (!result.success) assert.match(result.reason, /does not support singing/)
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

  assert.equal(await runtime.playAudio(buffer), true)
  assert.equal(forwarded, buffer)
})

test('StackchanRuntimeAudio reports unsupported playback as false', async () => {
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

  assert.equal(await runtimeWithoutSpeaker.playAudio(buffer), false)
  assert.equal(await runtimeUnsupported.playAudio(buffer), false)
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
  const playbackTTS = runtime.tts as { onPlayed?: (volume: number) => void; onDone?: () => void }
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
  const ttsCallbacks = runtime.tts as { onPlayed?: (volume: number) => void; onDone?: () => void }
  ttsCallbacks.onPlayed?.(2000)
  ttsCallbacks.onDone?.()
  assert.equal(mouthOpen, -1)
})

test('StackchanRuntimeAudio stops WebRadio before starting other playback', async () => {
  installBareSpecifierPackages()
  const { StackchanRuntimeAudio } = (await import('../runtime-audio.js')) as RuntimeAudioModule
  let stops = 0
  const webRadio = {
    state: 'playing' as const,
    start: async () => {},
    stop: () => {
      stops += 1
    },
    setVolume: () => {},
  }
  const runtime = new StackchanRuntimeAudio({
    tts: fakeTTS(),
    webRadio,
    speaker: { tone: async () => {}, play: async () => true },
  })

  await runtime.say('hello')
  await runtime.sing('#A4,20a')
  await runtime.tone(440, 20)
  await runtime.playAudio(new ArrayBuffer(2) as BorrowedAudioBuffer)
  assert.equal(stops, 4)
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
  await assert.rejects(runtime.webRadio?.start({ url: 'https://example.test/radio.mp3' }), /audio busy/)
  assert.equal(radioStarts, 0)
  complete?.()
  await speech
  await runtime.webRadio?.start({ url: 'https://example.test/radio.mp3' })
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

  const tone = runtime.tone(440, 20)
  const playback = runtime.playAudio(new ArrayBuffer(2) as BorrowedAudioBuffer)
  assert.equal(finishPlayback, undefined, 'queued playback must not open a second output')
  await assert.rejects(runtime.webRadio?.start({ url: 'https://example.test/radio.mp3' }), /audio busy/)

  finishTone?.()
  await tone
  await assert.rejects(runtime.webRadio?.start({ url: 'https://example.test/radio.mp3' }), /audio busy/)

  finishPlayback?.()
  await playback
  await runtime.webRadio?.start({ url: 'https://example.test/radio.mp3' })
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
  const speech = runtime.say('hello')
  const tone = runtime.tone(440, 100)
  await runtime.close()
  await assert.rejects(tone, { code: 'CLOSED' })
  assert.equal((await speech).success, false)
  late?.()
  assert.equal(cancelled, 1)
  assert.equal(tones, 0)
  await assert.rejects(runtime.tone(440, 100), { code: 'CLOSED' })
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
  const first = runtime.record(10, active.signal)
  const second = runtime.record(10, pending.signal)
  pending.cancel()
  await assert.rejects(second, { code: 'CANCELLED' })
  assert.equal(starts, 1)
  assert.equal(stops, 0)
  active.cancel()
  await assert.rejects(first, { code: 'CANCELLED' })
  assert.equal(stops, 1)
  complete(new ArrayBuffer(0) as OwnedAudioBuffer)
  await assert.rejects(runtime.record(15_001), { code: 'INVALID_ARGUMENT' })
  assert.equal(starts, 1, 'invalid duration never reaches the microphone')
  await runtime.close()
  await assert.rejects(runtime.record(10), { code: 'CLOSED' })
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
  await assert.rejects(broken.record(10), { code: 'CLOSED' })
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
  const speech = assert.rejects(runtime.speak('hello'), { code: 'IO', message: 'output did not release' })
  const tone = assert.rejects(runtime.tone(440, 100), { code: 'IO' })
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
  const speaking = assert.rejects(runtime.speak('hello'), { code: 'CLOSED' })
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
