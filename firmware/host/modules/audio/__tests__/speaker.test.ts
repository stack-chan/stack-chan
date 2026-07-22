import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  getModernAudioOutInstances,
  resetModernAudioOut,
  setModernAudioOutConstructorFailure,
} from '../../testing/fakes/modern-audio-out.js'
import { writeAliasPackage } from '../../testing/node-alias-package.js'
import type { BorrowedAudioBuffer } from '../audio-buffer.js'

const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
writeAliasPackage(modulesRoot, 'modern-audio-out', resolve(modulesRoot, 'testing/fakes/modern-audio-out.js'), {
  hasDefaultExport: true,
})
const { default: Speaker } = await import('../speaker.js')

const WAV_HEADER_SIZE = 44

function wav(samples: number[], sampleRate = 16_000, channels = 1): BorrowedAudioBuffer {
  const buffer = new ArrayBuffer(WAV_HEADER_SIZE + samples.length * 2)
  const view = new DataView(buffer)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint16(34, 16, true)
  for (let index = 0; index < samples.length; index += 1) {
    view.setInt16(WAV_HEADER_SIZE + index * 2, samples[index], true)
  }
  return buffer as BorrowedAudioBuffer
}

beforeEach(() => {
  resetModernAudioOut()
  ;(globalThis as typeof globalThis & { trace: (message: string) => void }).trace = () => {}
})

afterEach(() => {
  delete (globalThis as Partial<typeof globalThis & { trace: (message: string) => void }>).trace
})

test('tone streams PCM and waits for the queued audio to drain', async () => {
  const speaker = new Speaker({ volume: 0.25 })
  const playing = speaker.tone(440, 1)
  const output = getModernAudioOutInstances()[0]

  assert.equal(output.sampleRate, 24_000)
  assert.equal(output.channels, 1)
  assert.equal(output.volume, 0.25)
  assert.equal(output.started, 1)

  output.emitWritable(48)
  assert.equal(output.writes.length, 1)
  assert.equal(output.writes[0].byteLength, 48)
  assert.ok(output.writes[0].some((byte) => byte !== 0))
  assert.equal(output.closed, false)
  output.emitWritable(48)
  await playing

  assert.equal(output.stopped, 1)
  assert.equal(output.closed, true)
})

test('WAV playback forwards PCM through modern AudioOut and pads the final write', async () => {
  const speaker = new Speaker({ volume: 0.4 })
  const playing = speaker.play(wav([123, -456], 16_000, 1))
  const output = getModernAudioOutInstances()[0]
  output.emitWritable(8)
  output.emitWritable(8)

  assert.equal(await playing, true)
  assert.equal(output.sampleRate, 16_000)
  assert.equal(output.volume, 0.4)
  const bytes = output.writes[0]
  const samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2)
  assert.deepEqual(Array.from(samples), [123, -456, 0, 0])
})

test('WAV playback reports invalid input and AudioOut construction failures', async () => {
  const speaker = new Speaker()
  assert.equal(await speaker.play(new ArrayBuffer(10) as BorrowedAudioBuffer), false)
  const invalid = wav([1])
  new DataView(invalid).setUint16(34, 8, true)
  assert.equal(await speaker.play(invalid), false)

  setModernAudioOutConstructorFailure(new Error('output busy'))
  assert.equal(await speaker.play(wav([1])), false)
  await assert.rejects(speaker.tone(440, 10), /output busy/)
})
