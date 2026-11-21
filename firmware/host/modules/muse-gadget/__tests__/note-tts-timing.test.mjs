import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createMuseNotePlayer } from '../note-tts-player.js'

const source = (await readFile(new URL('../stopwatch-audio/output.js', import.meta.url), 'utf8'))
  .replace("import { pcmLevel } from 'stackchan/voice/levels'", 'const pcmLevel = () => 0')
const { openOutput } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

// A conservative one-block credit clock exercises the actual player and adapter.
test('PCM submission keeps pace with a 4092-byte DMA callback clock', async () => {
  const dmaBytes = 4092, pcmBytesPerSecond = 32000, frameCount = 48
  let elapsedMs = 0, audioBytes = 0, writes = 0
  globalThis.device = { audio: { Output: class {
    constructor(options) { this.options = options }
    start() { queueMicrotask(() => this.options.onWritable(dmaBytes)) }
    write(bytes) {
      elapsedMs += Math.ceil(bytes.length / dmaBytes) * dmaBytes / pcmBytesPerSecond * 1000
      writes++
      queueMicrotask(() => this.options.onWritable(dmaBytes))
    }
    close() {}
  } } }
  const output = openOutput(16000, 0, 6400)
  const play = createMuseNotePlayer({
    Decoder: class {
      decode(_input, output) { output.samples = 576; output.sampleRate = 24000; return 4 }
      close() {}
    },
    scan(_bytes, position) { return { position, length: 4, sampleRate: 24000, channels: 1 } },
    id3Size() { return 0 },
    resample() { return 384 },
    createPcmSource() {
      return {
        output: {},
        async push(bytes) {
          audioBytes += bytes.length
          await output.write(bytes)
        },
        end() {},
      }
    },
  })
  await play({ id: 'fixture' }, {
    backend: { readTts: async () => new ArrayBuffer(frameCount * 4) },
    media: {
      output: {
        budget: { maxBufferedBytes: 6400, maxBufferedMs: 200 },
        begin() { return {} }, finish() { return { state: 'played' } }, fence() {},
      },
      media: { connect: async () => ({ done: Promise.resolve(), close() {} }) },
    },
    signal: new AbortController().signal, generation: 0,
  })
  output.close()
  const audioMs = audioBytes / pcmBytesPerSecond * 1000
  assert.ok(elapsedMs <= audioMs + dmaBytes / pcmBytesPerSecond * 1000,
    `${writes} sequential writes need ${elapsedMs} ms to submit ${audioMs} ms of PCM`)
})
