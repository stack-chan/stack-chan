import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { writeAliasPackage, writeAliasPackageSubpath } from '../../testing/node-alias-package.js'
import type { BorrowedAudioBuffer } from '../audio-buffer.js'
import type { WasmAudioOutputBridge } from '../wasm/audio-bridge-contract.js'

async function setup() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  writeAliasPackageSubpath(root, 'stackchan', 'errors', resolve(root, '../../sdk/errors.js'))
  writeAliasPackage(root, 'tts-playback-session', resolve(root, 'audio/tts-playback-session.js'))
  writeAliasPackage(root, 'wasm-audio-bridge-contract', resolve(root, 'audio/wasm/audio-bridge-contract.js'))
  const timers = new Set<() => void>()
  const calls = { close: 0, tone: 0, play: 0 }
  const bridge: WasmAudioOutputBridge = {
    close() {
      calls.close += 1
    },
    tone() {
      calls.tone += 1
    },
    startPlayBuffer() {
      calls.play += 1
    },
    playStatus: () => 0,
    setTimer(callback) {
      timers.add(callback)
      return callback
    },
    clearTimer(handle) {
      timers.delete(handle as () => void)
    },
  }
  const env = globalThis as typeof globalThis & { __stackchanWasmAudioBridge?: WasmAudioOutputBridge }
  env.__stackchanWasmAudioBridge = bridge
  const { default: Speaker } = await import('../wasm/speaker.js')
  return { Speaker, timers, calls, env }
}

test('closing a WASM tone cancels its timer and settles playback once', async () => {
  const { Speaker, timers, calls, env } = await setup()
  try {
    const speaker = new Speaker()
    const tone = speaker.tone(440, 1_000)
    assert.equal(calls.tone, 1)
    assert.equal(timers.size, 1)
    const lateTimer = [...timers][0]
    speaker.close()
    speaker.close()
    await assert.rejects(tone, /closed/)
    lateTimer()
    assert.equal(calls.close, 1)
    assert.equal(timers.size, 0)
    await assert.rejects(speaker.tone(440, 100), /closed/)
  } finally {
    delete env.__stackchanWasmAudioBridge
  }
})

test('WASM buffer playback releases polling on cancellation across 100 sessions', async () => {
  const { Speaker, timers, calls, env } = await setup()
  try {
    for (let cycle = 0; cycle < 100; cycle += 1) {
      const speaker = new Speaker()
      const playback = speaker.play(new ArrayBuffer(48) as BorrowedAudioBuffer)
      assert.equal(timers.size, 1)
      speaker.close()
      await assert.rejects(playback, /closed/)
      assert.equal(timers.size, 0)
    }
    assert.equal(calls.play, 100)
    assert.equal(calls.close, 100)
  } finally {
    delete env.__stackchanWasmAudioBridge
  }
})
