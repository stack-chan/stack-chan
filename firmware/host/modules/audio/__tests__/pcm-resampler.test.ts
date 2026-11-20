import assert from 'node:assert/strict'
import test from 'node:test'

import resamplePCM16Mono from '../../testing/fakes/pcm-resampler.js'

const SOURCE_RATE = 44_100
const TARGET_RATE = 24_000
const MP3_FRAME_SAMPLES = 1152

function inputPCM(sampleCount: number): Int16Array {
  const input = new Int16Array(sampleCount)
  for (let index = 0; index < input.length; index += 1) {
    input[index] = Math.round(Math.sin((index * Math.PI) / 17) * 20_000)
  }
  return input
}

function resample(input: Int16Array, chunkSamples: number): Int16Array {
  const state = new Int32Array(3)
  const chunks: Int16Array[] = []
  let total = 0
  for (let offset = 0; offset < input.length; offset += chunkSamples) {
    const count = Math.min(chunkSamples, input.length - offset)
    const output = new ArrayBuffer((Math.ceil((count * TARGET_RATE) / SOURCE_RATE) + 1) * 2)
    const outputCount = resamplePCM16Mono(input.buffer, offset, count, output, SOURCE_RATE, TARGET_RATE, state)
    const chunk = new Int16Array(output, 0, outputCount)
    chunks.push(chunk)
    total += chunk.length
  }
  const result = new Int16Array(total)
  let position = 0
  for (const chunk of chunks) {
    result.set(chunk, position)
    position += chunk.length
  }
  return result
}

test('streaming resampling is continuous across decoded MP3 frame boundaries', () => {
  const input = inputPCM(MP3_FRAME_SAMPLES * 4)
  const continuous = resample(input, input.length)
  const framed = resample(input, MP3_FRAME_SAMPLES)

  assert.deepEqual(framed, continuous)
})
