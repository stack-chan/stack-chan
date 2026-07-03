import type { BorrowedAudioBuffer, OwnedAudioBuffer } from 'audio-buffer'
import type { TTS } from 'capabilities'
import type Microphone from 'microphone'
import { type Maybe, noop, waitForCompletion } from 'stackchan-util'
import type Tone from 'tone'

export type RuntimeAudioConstructorParam = {
  tts: TTS
  microphone?: Microphone
  tone?: Tone
}

type RuntimeAudioOptions = {
  onMouthOpenChanged?: (value: number) => void
}

export class StackchanRuntimeAudio {
  #microphone: Microphone | undefined
  #options: RuntimeAudioOptions
  #tone: Tone | undefined
  #tts: TTS

  constructor(params: RuntimeAudioConstructorParam, options: RuntimeAudioOptions = {}) {
    this.#options = options
    this.#microphone = params.microphone
    this.#tone = params.tone
    this.useTTS(params.tts)
  }

  get microphone() {
    return this.#microphone
  }

  get tts(): TTS {
    return this.#tts
  }

  useTTS(tts: TTS) {
    if (this.#tts != null) {
      this.#tts.onDone = noop
      this.#tts.onPlayed = noop
    }
    this.#tts = tts
    this.#tts.onPlayed = (volume: number) => {
      this.#options.onMouthOpenChanged?.(volume === 0 ? 0 : Math.min(volume / 2000, 1.0))
    }
    this.#tts.onDone = () => {
      this.#options.onMouthOpenChanged?.(0)
    }
  }

  async say(text: string, volume?: number): Promise<Maybe<string>> {
    try {
      await waitForCompletion((callback) => this.#tts.stream(text, volume, callback))
      return {
        success: true,
        value: text,
      }
    } catch (reason) {
      trace('error\n')
      return {
        success: false,
        reason: String(reason),
      }
    }
  }

  async record(durationMilliSec?: number): Promise<OwnedAudioBuffer> {
    if (!this.#microphone) {
      throw Error('This device does not support a microphone.')
    }
    return this.#microphone.record(durationMilliSec)
  }

  async tone(hz: number, duration: number, volume?: number): Promise<void> {
    if (volume !== undefined && (volume < 0 || volume > 1)) {
      throw new Error('Volume must be between 0 and 1')
    }
    return this.#tone?.tone(hz, duration, volume)
  }

  async playAudio(buffer: BorrowedAudioBuffer): Promise<boolean> {
    if (!this.#tone) return false
    return this.#tone.play(buffer)
  }
}
