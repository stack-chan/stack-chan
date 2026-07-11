import AudioOut from 'embedded:io/audio/out'
import calculatePower from 'calculate-power'
import Resource from 'Resource'
import StackchanVoice from 'stackchanvoice'
import { beginTTSPlayback, type TTSPlaybackLifecycle } from 'tts-playback-lifecycle'
import type { TTSCompletion, TTSDoneListener, TTSPlaybackListener } from 'tts-types'

const OUTPUT_SAMPLE_RATE = 24000
const BYTES_PER_SAMPLE = 2
const ASYNC_BUFFER_SAMPLES = 1024
const ASYNC_BUFFER_COUNT = 4

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
  power: number
}

type AsyncAudioOut = AudioOut & {
  write(buffer: ArrayBuffer, completion: () => void): void
}

type AudioOutWithAsync = typeof AudioOut & {
  Async: new (options: { sampleRate: number; bitsPerSample: 16; channels: 1 }) => AsyncAudioOut
}

export class TTS {
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
  streaming = false
  readonly volume: number
  readonly speed: number
  readonly voice: StackchanVoice

  #output?: AsyncAudioOut
  #lifecycle?: TTSPlaybackLifecycle
  #generating = false
  #queued = 0
  readonly #chunks: PCMChunk[]

  constructor(props: TTSProperty = {}) {
    this.onPlayed = props.onPlayed
    this.onDone = props.onDone
    this.volume = props.volume ?? 0.1
    this.speed = props.speed ?? 100
    const preset = props.voice === 'cute' ? StackchanVoice.Cute : StackchanVoice.Normal
    this.voice = new StackchanVoice(preset, new Resource('stackchan-ja.aqd'))
    this.#chunks = Array.from({ length: ASYNC_BUFFER_COUNT }, () => {
      const buffer = new ArrayBuffer(ASYNC_BUFFER_SAMPLES * BYTES_PER_SAMPLE)
      return { buffer, bytes: new Uint8Array(buffer), samples: ASYNC_BUFFER_SAMPLES, power: 0 }
    })
  }

  stream(text: string, volume?: number, callback?: TTSCompletion): void {
    const lifecycle = beginTTSPlayback(this, callback)
    if (!lifecycle) return

    try {
      this.#resetPlayback(lifecycle)
      this.voice.say(text, this.speed)
      this.#generating = true

      const AsyncAudioOut = (AudioOut as AudioOutWithAsync).Async
      const output = new AsyncAudioOut({
        sampleRate: OUTPUT_SAMPLE_RATE,
        bitsPerSample: 16,
        channels: 1,
      })
      output.volume = volume ?? this.volume
      this.#output = output
      lifecycle.addCleanup(() => {
        try {
          output.stop()
        } finally {
          output.close()
          if (this.#output === output) this.#output = undefined
          if (this.#lifecycle === lifecycle) this.#lifecycle = undefined
        }
      })
      output.start()
      for (const chunk of this.#chunks) {
        if (!this.#queueChunk(chunk)) break
      }
      if (this.#queued === 0) lifecycle.onDone()
    } catch (error) {
      lifecycle.fail(error)
    }
  }

  #resetPlayback(lifecycle: TTSPlaybackLifecycle): void {
    this.#lifecycle = lifecycle
    this.#generating = false
    this.#queued = 0
  }

  #queueChunk(chunk: PCMChunk): boolean {
    const lifecycle = this.#lifecycle
    const output = this.#output
    if (!lifecycle || !output || !this.streaming || !this.#generating) return false

    try {
      const samples = this.voice.read24(chunk.buffer)
      if (samples === 0) {
        this.#generating = false
        return false
      }
      if (samples < chunk.samples) {
        chunk.bytes.fill(0, samples * BYTES_PER_SAMPLE)
        this.#generating = false
      }
      chunk.power = calculatePower(chunk.buffer)
      this.#queued += 1
      output.write(chunk.buffer, () => this.#onChunkPlayed(chunk))
      return true
    } catch (error) {
      lifecycle.fail(error)
      return false
    }
  }

  #onChunkPlayed(chunk: PCMChunk): void {
    const lifecycle = this.#lifecycle
    if (!lifecycle || !this.streaming) return
    this.#queued -= 1
    lifecycle.onPower(chunk.power)
    if (this.#generating && this.#queueChunk(chunk)) return
    if (this.#queued === 0) lifecycle.onDone()
  }
}
