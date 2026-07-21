import type { BorrowedAudioBuffer, OwnedAudioBuffer } from 'audio-buffer'
import type { TTS, WebRadioCapability, WebRadioStartOptions } from 'capabilities'
import type Microphone from 'microphone'
import type Speaker from 'speaker'
import { type Maybe, noop, waitForCompletion } from 'stackchan-util'

export type RuntimeAudioConstructorParam = {
  tts: TTS
  microphone?: Microphone
  speaker?: Speaker
  webRadio?: WebRadioCapability
}

type RuntimeAudioOptions = {
  onMouthOpenChanged?: (value: number) => void
}

export class StackchanRuntimeAudio {
  #microphone: Microphone | undefined
  #options: RuntimeAudioOptions
  #speaker: Speaker | undefined
  #tts: TTS
  #webRadio: WebRadioCapability | undefined
  #activeOperations = 0

  constructor(params: RuntimeAudioConstructorParam, options: RuntimeAudioOptions = {}) {
    this.#options = options
    this.#microphone = params.microphone
    this.#speaker = params.speaker
    this.#webRadio = params.webRadio
    this.useTTS(params.tts)
  }

  get microphone() {
    return this.#microphone
  }

  get tts(): TTS {
    return this.#tts
  }

  get webRadio(): WebRadioCapability | undefined {
    if (!this.#webRadio) return undefined
    const runtime = this
    return {
      get state() {
        return runtime.#webRadio?.state ?? 'idle'
      },
      start(options: WebRadioStartOptions) {
        if (runtime.#activeOperations > 0) return Promise.reject(new Error('audio busy'))
        const webRadio = runtime.#webRadio
        if (!webRadio) return Promise.reject(new Error('WebRadio is not supported'))
        return webRadio.start(options)
      },
      stop() {
        runtime.#webRadio?.stop()
      },
      setVolume(volume: number) {
        runtime.#webRadio?.setVolume(volume)
      },
    }
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
    this.#webRadio?.stop()
    this.#activeOperations += 1
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
    } finally {
      this.#activeOperations -= 1
    }
  }

  async sing(koe: string, volume?: number): Promise<Maybe<string>> {
    this.#webRadio?.stop()
    this.#activeOperations += 1
    try {
      const tts = this.#tts
      if (!tts.streamKoe) throw new Error('The active TTS does not support singing.')
      await waitForCompletion((callback) => tts.streamKoe(koe, volume, callback))
      return {
        success: true,
        value: koe,
      }
    } catch (reason) {
      trace('error\n')
      return {
        success: false,
        reason: String(reason),
      }
    } finally {
      this.#activeOperations -= 1
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
    this.#webRadio?.stop()
    this.#activeOperations += 1
    try {
      await this.#speaker?.tone(hz, duration, volume)
    } finally {
      this.#activeOperations -= 1
    }
  }

  async playAudio(buffer: BorrowedAudioBuffer): Promise<boolean> {
    if (!this.#speaker) return false
    this.#webRadio?.stop()
    this.#activeOperations += 1
    try {
      return await this.#speaker.play(buffer)
    } finally {
      this.#activeOperations -= 1
    }
  }

  close(): void {
    try {
      this.#webRadio?.stop()
    } finally {
      try {
        this.#microphone?.stop()
      } finally {
        this.#tts.onPlayed = noop
        this.#tts.onDone = noop
      }
    }
  }
}
