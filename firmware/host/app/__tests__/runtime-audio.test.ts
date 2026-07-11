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
  }
}

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
  const playbackTTS = runtime.tts as { onPlayed?: (volume: number) => void; onDone?: () => void }
  playbackTTS.onPlayed?.(2000)
  playbackTTS.onDone?.()
  assert.equal(mouthOpen, -1)
})
