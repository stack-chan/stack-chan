import AudioOut from 'embedded:io/audio/out'
import calculatePower from 'calculate-power'
import Resource from 'Resource'
import StackchanVoice from 'stackchanvoice'
import Timer from 'timer'
import { beginTTSPlayback, type TTSPlaybackLifecycle } from 'tts-playback-lifecycle'
import type { TTSCompletion, TTSDoneListener, TTSPlaybackListener } from 'tts-types'

const OUTPUT_SAMPLE_RATE = 24000
const BYTES_PER_SAMPLE = 2
const DRAIN_MARGIN_MS = 50
const FIFO_LENGTH = 64

export type TTSProperty = {
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
  volume?: number
  speed?: number
  voice?: 'normal' | 'cute'
}

type PCMChunk = {
  buffer: ArrayBuffer
  bytes: Uint8Array
  samples: number
}

export class TTS {
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
  streaming = false
  readonly volume: number
  readonly speed: number
  readonly voice: StackchanVoice

  #output?: AudioOut
  #lifecycle?: TTSPlaybackLifecycle
  #generating = false
  #pendingBytes = 0
  #drainTimer?: ReturnType<typeof Timer.set>
  #fifoHead = 0
  #fifoTail = 0
  #fifoCount = 0
  readonly #fifoBytes = new Uint32Array(FIFO_LENGTH)
  readonly #fifoPower = new Float64Array(FIFO_LENGTH)
  readonly #chunks: PCMChunk[]

  constructor(props: TTSProperty = {}) {
    this.onPlayed = props.onPlayed
    this.onDone = props.onDone
    this.volume = props.volume ?? 0.1
    this.speed = props.speed ?? 100
    const preset = props.voice === 'cute' ? StackchanVoice.Cute : StackchanVoice.Normal
    this.voice = new StackchanVoice(preset, new Resource('stackchan-ja.aqd'))
    this.#chunks = [256, 128, 64, 32, 16, 8, 4, 2, 1].map((samples) => {
      const buffer = new ArrayBuffer(samples * BYTES_PER_SAMPLE)
      return { buffer, bytes: new Uint8Array(buffer), samples }
    })
  }

  stream(text: string, volume?: number, callback?: TTSCompletion): void {
    const lifecycle = beginTTSPlayback(this, callback)
    if (!lifecycle) return

    try {
      this.#resetPlayback(lifecycle)
      this.voice.say(text, this.speed)
      this.#generating = true

      const output = new AudioOut({
        sampleRate: OUTPUT_SAMPLE_RATE,
        bitsPerSample: 16,
        channels: 1,
        onWritable: (size) => this.#onWritable(size),
      })
      output.volume = volume ?? this.volume
      this.#output = output
      lifecycle.addCleanup(() => {
        if (this.#drainTimer !== undefined) {
          Timer.clear(this.#drainTimer)
          this.#drainTimer = undefined
        }
        try {
          output.stop()
        } finally {
          output.close()
          if (this.#output === output) this.#output = undefined
          if (this.#lifecycle === lifecycle) this.#lifecycle = undefined
        }
      })
      output.start()
    } catch (error) {
      lifecycle.fail(error)
    }
  }

  #resetPlayback(lifecycle: TTSPlaybackLifecycle): void {
    this.#lifecycle = lifecycle
    this.#generating = false
    this.#pendingBytes = 0
    this.#fifoHead = 0
    this.#fifoTail = 0
    this.#fifoCount = 0
    this.#drainTimer = undefined
  }

  #onWritable(size: number): void {
    const lifecycle = this.#lifecycle
    const output = this.#output
    if (!lifecycle || !output || !this.streaming) return

    try {
      this.#reportConsumed(Math.min(size, this.#pendingBytes), lifecycle)
      if (!this.#generating) {
        if (this.#pendingBytes === 0) lifecycle.onDone()
        return
      }

      let remaining = size - (size % BYTES_PER_SAMPLE)
      while (remaining >= BYTES_PER_SAMPLE && this.#generating) {
        const chunk = this.#chunkFor(remaining)
        const samples = this.voice.read24(chunk.buffer)
        if (samples === 0) {
          this.#generating = false
          break
        }
        if (samples < chunk.samples) {
          chunk.bytes.fill(0, samples * BYTES_PER_SAMPLE)
          this.#generating = false
        }

        output.write(chunk.buffer)
        this.#enqueue(chunk.buffer.byteLength, calculatePower(chunk.buffer))
        remaining -= chunk.buffer.byteLength
      }

      if (!this.#generating) this.#beginDrain(lifecycle)
    } catch (error) {
      lifecycle.fail(error)
    }
  }

  #chunkFor(byteLength: number): PCMChunk {
    for (const chunk of this.#chunks) {
      if (chunk.buffer.byteLength <= byteLength) return chunk
    }
    return this.#chunks[this.#chunks.length - 1]
  }

  #enqueue(bytes: number, power: number): void {
    if (this.#fifoCount >= FIFO_LENGTH) throw new Error('stackchan-voice playback queue overflow')
    this.#fifoBytes[this.#fifoTail] = bytes
    this.#fifoPower[this.#fifoTail] = power
    this.#fifoTail = (this.#fifoTail + 1) % FIFO_LENGTH
    this.#fifoCount += 1
    this.#pendingBytes += bytes
  }

  #reportConsumed(bytes: number, lifecycle: TTSPlaybackLifecycle): void {
    let remaining = bytes
    let weightedPower = 0
    let consumed = 0
    while (remaining > 0 && this.#fifoCount > 0) {
      const entryBytes = this.#fifoBytes[this.#fifoHead]
      const take = Math.min(remaining, entryBytes)
      weightedPower += this.#fifoPower[this.#fifoHead] * take
      consumed += take
      remaining -= take
      this.#pendingBytes -= take
      this.#fifoBytes[this.#fifoHead] = entryBytes - take
      if (this.#fifoBytes[this.#fifoHead] === 0) {
        this.#fifoHead = (this.#fifoHead + 1) % FIFO_LENGTH
        this.#fifoCount -= 1
      }
    }
    if (consumed > 0) lifecycle.onPower(weightedPower / consumed)
  }

  #beginDrain(lifecycle: TTSPlaybackLifecycle): void {
    if (this.#pendingBytes === 0) {
      lifecycle.onDone()
      return
    }
    if (this.#drainTimer !== undefined) return
    const drainMs = Math.ceil((this.#pendingBytes * 1000) / (OUTPUT_SAMPLE_RATE * BYTES_PER_SAMPLE)) + DRAIN_MARGIN_MS
    this.#drainTimer = Timer.set(() => {
      this.#drainTimer = undefined
      lifecycle.onDone()
    }, drainMs)
  }
}
