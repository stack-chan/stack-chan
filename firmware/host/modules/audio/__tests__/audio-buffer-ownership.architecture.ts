import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const playbackCopyPatterns = [
  /\.slice\(/,
  /ArrayBuffer\.from\(/,
  /new ArrayBuffer\(buffer\.byteLength\)/,
  /new Uint8Array\(buffer\)/,
]

test('audio buffer APIs document record ownership and playback borrowing', () => {
  const bufferTypes = readFileSync('host/modules/audio/audio-buffer.ts', 'utf8')
  const capabilities = readFileSync('host/app/capabilities.ts', 'utf8')
  const runtimeAudio = readFileSync('host/app/runtime-audio.ts', 'utf8')
  const microphone = readFileSync('host/modules/audio/microphone.ts', 'utf8')
  const wasmMicrophone = readFileSync('host/modules/audio/wasm/microphone.ts', 'utf8')
  const wasmTone = readFileSync('host/modules/audio/wasm/tone.ts', 'utf8')

  assert.match(bufferTypes, /export type OwnedAudioBuffer/)
  assert.match(bufferTypes, /export type BorrowedAudioBuffer/)
  assert.match(microphone, /Promise<OwnedAudioBuffer>/)
  assert.match(wasmMicrophone, /Promise<OwnedAudioBuffer>/)
  assert.match(capabilities, /record\(durationMilliSec\?: number\): Promise<OwnedAudioBuffer>/)
  assert.match(capabilities, /playAudio\(buffer: BorrowedAudioBuffer\): Promise<boolean>/)
  assert.match(runtimeAudio, /playAudio\(buffer: BorrowedAudioBuffer\): Promise<boolean>/)
  assert.match(wasmTone, /play\(buffer: BorrowedAudioBuffer\): Promise<boolean>/)
})

test('playback path forwards large ArrayBuffers without copy helpers', () => {
  const playbackSources = [
    readFileSync('host/app/runtime-audio.ts', 'utf8'),
    readFileSync('host/modules/audio/wasm/tone.ts', 'utf8'),
  ].join('\n')

  for (const pattern of playbackCopyPatterns) {
    assert.doesNotMatch(playbackSources, pattern)
  }
  assert.match(playbackSources, /player\?\.play\?\.\(buffer\)/)
  assert.match(playbackSources, /audioBridge\.startPlayBuffer\(buffer\)/)
})
