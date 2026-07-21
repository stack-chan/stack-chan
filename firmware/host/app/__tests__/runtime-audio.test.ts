import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import type { BorrowedAudioBuffer } from '../../modules/audio/audio-buffer.js'
import { writeAliasPackage } from '../../modules/testing/node-alias-package.js'

type RuntimeAudioModule = typeof import('../runtime-audio.js')

function installBareSpecifierPackages(): void {
  const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
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
  runtime.close()

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

  assert.throws(() => runtime.close(), /stop failure/)
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

test('StackchanRuntimeAudio stays busy until all overlapping playback completes', async () => {
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
  runtime.close()
  assert.equal(stopped, true)
})
