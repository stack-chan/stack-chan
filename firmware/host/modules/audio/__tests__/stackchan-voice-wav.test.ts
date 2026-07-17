import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  renderStackchanVoiceWav,
  STACKCHAN_VOICE_OUTPUT_SAMPLE_RATE,
  type StackchanVoiceRenderer,
} from '../wasm/stackchan-voice-wav.js'

class FakeStackchanVoice implements StackchanVoiceRenderer {
  readonly sayCalls: Array<{ text: string; speed?: number }> = []
  #offset = 0

  constructor(readonly samples: Int16Array) {}

  say(text: string, speed?: number): void {
    this.sayCalls.push({ text, speed })
    this.#offset = 0
  }

  read24(buffer: ArrayBuffer): number {
    if (this.#offset >= this.samples.length) return 0
    const output = new Int16Array(buffer)
    const count = Math.min(output.length, this.samples.length - this.#offset)
    output.set(this.samples.subarray(this.#offset, this.#offset + count))
    this.#offset += count
    return count
  }
}

function ascii(buffer: ArrayBuffer, offset: number, length: number): string {
  return String.fromCharCode(...new Uint8Array(buffer, offset, length))
}

test('renderStackchanVoiceWav renders 24 kHz mono PCM with volume and a valid WAV header', async () => {
  const voice = new FakeStackchanVoice(new Int16Array([1000, -1000, 2000]))

  const rendered = await renderStackchanVoiceWav(voice, 'こんにちは', {
    chunkSamples: 2,
    schedule: queueMicrotask,
    speed: 120,
    volume: 0.5,
  })

  const header = new DataView(rendered.buffer)
  const pcm = new Int16Array(rendered.buffer, 44)
  assert.deepEqual(voice.sayCalls, [{ text: 'こんにちは', speed: 120 }])
  assert.equal(ascii(rendered.buffer, 0, 4), 'RIFF')
  assert.equal(ascii(rendered.buffer, 8, 4), 'WAVE')
  assert.equal(ascii(rendered.buffer, 12, 4), 'fmt ')
  assert.equal(ascii(rendered.buffer, 36, 4), 'data')
  assert.equal(header.getUint16(20, true), 1)
  assert.equal(header.getUint16(22, true), 1)
  assert.equal(header.getUint32(24, true), STACKCHAN_VOICE_OUTPUT_SAMPLE_RATE)
  assert.equal(header.getUint16(34, true), 16)
  assert.equal(header.getUint32(40, true), 6)
  assert.deepEqual([...pcm], [500, -500, 1000])
  assert.equal(rendered.samples, 3)
  assert.equal(rendered.power, Math.sqrt((500 ** 2 + 500 ** 2 + 1000 ** 2) / 3))
})

test('renderStackchanVoiceWav grows its PCM buffer and clamps volume', async () => {
  const samples = Int16Array.from({ length: 6000 }, (_, index) => (index % 2 === 0 ? 20000 : -20000))
  const voice = new FakeStackchanVoice(samples)

  const rendered = await renderStackchanVoiceWav(voice, '長い文章', {
    chunkSamples: 257,
    schedule: queueMicrotask,
    volume: 2,
  })

  assert.equal(rendered.samples, samples.length)
  assert.equal(rendered.buffer.byteLength, 44 + samples.byteLength)
  assert.deepEqual([...new Int16Array(rendered.buffer, 44, 4)], [20000, -20000, 20000, -20000])
})

test('renderStackchanVoiceWav emits an empty but valid WAV for an empty utterance', async () => {
  const rendered = await renderStackchanVoiceWav(new FakeStackchanVoice(new Int16Array()), '', {
    schedule: queueMicrotask,
    volume: -1,
  })

  assert.equal(rendered.samples, 0)
  assert.equal(rendered.power, 0)
  assert.equal(rendered.buffer.byteLength, 44)
  assert.equal(new DataView(rendered.buffer).getUint32(40, true), 0)
})

test('renderStackchanVoiceWav yields before and between native chunks', async () => {
  const voice = new FakeStackchanVoice(new Int16Array([1, 2, 3]))
  const tasks: Array<() => void> = []
  const renderedPromise = renderStackchanVoiceWav(voice, 'scheduled', {
    chunkSamples: 2,
    schedule: (task) => tasks.push(task),
  })

  assert.equal(voice.sayCalls.length, 0)
  assert.equal(tasks.length, 1)
  while (tasks.length > 0) tasks.shift()?.()

  const rendered = await renderedPromise
  assert.equal(rendered.samples, 3)
  assert.deepEqual(voice.sayCalls, [{ text: 'scheduled', speed: 100 }])
})

test('renderStackchanVoiceWav rejects a renderer that exceeds the sample bound', async () => {
  const endlessVoice: StackchanVoiceRenderer = {
    say: () => {},
    read24: (buffer) => {
      new Int16Array(buffer).fill(1)
      return new Int16Array(buffer).length
    },
  }

  await assert.rejects(
    renderStackchanVoiceWav(endlessVoice, 'endless', {
      chunkSamples: 4,
      maxSamples: 5,
      schedule: queueMicrotask,
    }),
    /maximum of 5 samples/,
  )
})
