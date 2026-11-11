import type { BorrowedAudioBuffer, OwnedAudioBuffer } from 'audio-buffer'
import type {
  FiniteMediaSession,
  FiniteMediaSource,
  LiveMediaSource,
  MediaOpenOptions,
  MediaSession,
  MediaCapability,
  MediaStartOptions,
  SpeechPlayback,
  WebRadioCapability,
  WebRadioStartOptions,
} from 'capabilities'
import type Microphone from 'microphone'
import type Speaker from 'speaker'
import type { SpeakerSpeechPlayback, UtterancePlayback } from 'speech-playback-types'
import type { Speaker as VoiceSpeaker } from 'stackchan/voice/contracts'
import { type Maybe, noop, waitForCompletion } from 'stackchan-util'
import { DEFAULT_VOLUME, MAX_MEDIA_VOLUME } from 'volume-model'

export type RuntimeAudioConstructorParam = {
  speechPlayback: SpeechPlayback | SpeakerSpeechPlayback
  microphone?: Microphone
  speaker?: Speaker
  webRadio?: WebRadioCapability
  media?: MediaCapability
  volume?: number
  onVolumeChanged?: (volume: number) => void
}

type RuntimeAudioOptions = {
  getVoiceSpeaker?: () => VoiceSpeaker
  onMouthOpenChanged?: (value: number) => void
}

export class StackchanRuntimeAudio {
  #microphone: Microphone | undefined
  #options: RuntimeAudioOptions
  #speaker: Speaker | undefined
  #speechPlayback: SpeechPlayback | SpeakerSpeechPlayback
  #webRadio: WebRadioCapability | undefined
  #media: MediaCapability | undefined
  #activeOperations = 0
  #utterance?: UtterancePlayback
  #closed = false
  #volume: number | undefined
  #onVolumeChanged: RuntimeAudioConstructorParam['onVolumeChanged']
  #exclusive = false

  constructor(params: RuntimeAudioConstructorParam, options: RuntimeAudioOptions = {}) {
    this.#options = options
    this.#microphone = params.microphone
    this.#speaker = params.speaker
    this.#webRadio = params.webRadio
    this.#media = params.media
    this.#volume = params.volume
    this.#onVolumeChanged = params.onVolumeChanged
    this.useSpeechPlayback(params.speechPlayback)
  }

  get volume(): number {
    return this.#volume ?? DEFAULT_VOLUME
  }

  set volume(volume: number) {
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) throw new Error('Volume must be between 0 and 1')
    if (volume === this.#volume) return
    this.#onVolumeChanged?.(volume)
    this.#volume = volume
    // WASM speakers accept tone volume per call but have no mutable volume property.
    if (this.#speaker && 'volume' in this.#speaker) this.#speaker.volume = volume
    this.#media?.setVolume(volume * MAX_MEDIA_VOLUME)
    if (!this.#media) this.#webRadio?.setVolume(volume * MAX_MEDIA_VOLUME)
  }

  get hasMicrophone() {
    return this.#microphone !== undefined
  }

  #stopMedia() {
    const stopped = this.#media?.stop()
    const radio = this.#webRadio?.stop()
    if (stopped && radio) return Promise.all([stopped, radio]).then(() => {})
    return stopped || radio
  }

  acquireExclusive(interruptible = false): (() => void) | Promise<() => void> {
    if (this.#closed || this.#exclusive || this.#activeOperations || this.#microphone?.recording)
      throw new Error('audio busy')
    if (interruptible) return noop
    this.#exclusive = true
    let released = false
    const release = () => {
      if (released) return
      released = true
      this.#exclusive = false
    }
    try {
      const stopping = this.#stopMedia()
      if (stopping)
        return stopping.then(
          () => release,
          (error) => {
            release()
            throw error
          },
        )
      return release
    } catch (error) {
      release()
      throw error
    }
  }

  get media(): MediaCapability | undefined {
    const media = this.#media
    if (!media) return undefined
    const runtime = this
    const player = media
    function open(source: LiveMediaSource, options: MediaOpenOptions): Promise<MediaSession>
    function open(source: FiniteMediaSource, options: MediaOpenOptions): Promise<FiniteMediaSession>
    function open(source: LiveMediaSource | FiniteMediaSource, options: MediaOpenOptions) {
      if (runtime.#closed || runtime.#exclusive || runtime.#activeOperations)
        return Promise.reject(new Error('audio busy'))
      const settings = {
        ...options,
        volume: options.volume ?? (runtime.#volume === undefined ? undefined : runtime.#volume * MAX_MEDIA_VOLUME),
      }
      return source.mode === 'live' ? player.open(source, settings) : player.open(source, settings)
    }
    return {
      open,
      get state() {
        return media.state
      },
      get progress() {
        return media.progress
      },
      pause() {
        return media.pause()
      },
      resume() {
        if (runtime.#closed || runtime.#exclusive || runtime.#activeOperations > 0)
          return Promise.reject(new Error('audio busy'))
        return media.resume()
      },
      seek(seconds: number) {
        if (runtime.#closed || runtime.#exclusive || runtime.#activeOperations > 0)
          return Promise.reject(new Error('audio busy'))
        return media.seek(seconds)
      },
      start(options: MediaStartOptions) {
        if (runtime.#closed || runtime.#exclusive || runtime.#activeOperations > 0)
          return Promise.reject(new Error('audio busy'))
        return media.start({
          ...options,
          volume: options.volume ?? (runtime.#volume === undefined ? undefined : runtime.#volume * MAX_MEDIA_VOLUME),
        })
      },
      stop() {
        return media.stop()
      },
      setVolume(volume: number) {
        media.setVolume(volume)
      },
    }
  }

  get webRadio(): WebRadioCapability | undefined {
    const media = this.media
    if (media)
      return {
        get state() {
          return media.state === 'ended' || media.state === 'paused' ? 'idle' : media.state
        },
        async start(options: WebRadioStartOptions) {
          if ((options.sampleRate ?? 44100) !== 44100)
            throw new Error('WebRadio supports only 44100 Hz sampleRate options')
          return media.start({
            ...options,
            mode: 'live',
            onStateChanged: (state, reason) =>
              options.onStateChanged?.(state === 'ended' || state === 'paused' ? 'idle' : state, reason),
          })
        },
        stop() {
          return media.stop()
        },
        setVolume(volume: number) {
          media.setVolume(volume)
        },
      }
    if (!this.#webRadio) return undefined
    const runtime = this
    return {
      get state() {
        return runtime.#webRadio?.state ?? 'idle'
      },
      start(options: WebRadioStartOptions) {
        if (runtime.#closed || runtime.#exclusive || runtime.#activeOperations > 0)
          return Promise.reject(new Error('audio busy'))
        const webRadio = runtime.#webRadio
        if (!webRadio) return Promise.reject(new Error('WebRadio is not supported'))
        return webRadio.start({
          ...options,
          volume: options.volume ?? (runtime.#volume === undefined ? undefined : runtime.#volume * MAX_MEDIA_VOLUME),
        })
      },
      stop() {
        runtime.#webRadio?.stop()
      },
      setVolume(volume: number) {
        runtime.#webRadio?.setVolume(volume)
      },
    }
  }

  useSpeechPlayback(speechPlayback: SpeechPlayback | SpeakerSpeechPlayback) {
    if (this.#closed || this.#exclusive || this.#activeOperations || this.#utterance) throw new Error('audio busy')
    if (this.#speechPlayback && 'stream' in this.#speechPlayback) {
      this.#speechPlayback.onDone = noop
      this.#speechPlayback.onPlayed = noop
    }
    this.#speechPlayback = speechPlayback
    if ('stream' in speechPlayback) {
      speechPlayback.onPlayed = this.#onPlayed
      speechPlayback.onDone = () => this.#onPlayed(0)
    }
  }

  #onPlayed = (power: number) => {
    try {
      this.#options.onMouthOpenChanged?.(Math.min(power / 2000, 1))
    } catch {
      // Face updates must preserve the speaker's playback result.
    }
  }

  say(text: string, volume?: number) {
    return this.#speak('text', text, volume)
  }

  sing(koe: string, volume?: number) {
    return this.#speak('koe', koe, volume)
  }

  async #speak(kind: 'text' | 'koe', text: string, volume?: number): Promise<Maybe<string>> {
    if (this.#closed || this.#exclusive || this.#utterance) return { success: false, reason: 'audio busy' }
    const playback = this.#speechPlayback
    const gain = volume ?? this.#volume
    try {
      if ('playUtterance' in playback) {
        const speaker = this.#options.getVoiceSpeaker?.()
        if (!speaker) throw new Error('speaker unavailable')
        const utterance = playback.playUtterance(speaker, kind, text, gain, this.#onPlayed)
        this.#utterance = utterance
        try {
          await utterance.done
        } finally {
          this.#utterance = undefined
          this.#onPlayed(0)
        }
      } else {
        this.#activeOperations += 1
        try {
          const stopping = this.#stopMedia()
          if (stopping) await stopping
          const stream = kind === 'text' ? playback.stream : playback.streamKoe
          if (!stream) throw new Error('The active speech player does not support singing.')
          await waitForCompletion((callback) => stream.call(playback, text, gain, callback))
        } finally {
          this.#activeOperations -= 1
        }
      }
      return { success: true, value: text }
    } catch (reason) {
      return { success: false, reason: String(reason) }
    }
  }

  async record(durationMilliSec?: number): Promise<OwnedAudioBuffer> {
    if (this.#exclusive) throw new Error('audio busy')
    if (!this.#microphone) {
      throw Error('This device does not support a microphone.')
    }
    this.#activeOperations += 1
    try {
      const stopping = this.#stopMedia()
      if (stopping) await stopping
      return await this.#microphone.record(durationMilliSec)
    } finally {
      this.#activeOperations -= 1
    }
  }

  async tone(hz: number, duration: number, volume?: number): Promise<void> {
    if (this.#exclusive) throw new Error('audio busy')
    if (volume !== undefined && (volume < 0 || volume > 1)) {
      throw new Error('Volume must be between 0 and 1')
    }
    this.#activeOperations += 1
    try {
      const stopping = this.#stopMedia()
      if (stopping) await stopping
      await this.#speaker?.tone(hz, duration, volume ?? this.#volume)
    } finally {
      this.#activeOperations -= 1
    }
  }

  async playAudio(buffer: BorrowedAudioBuffer): Promise<boolean> {
    if (this.#exclusive) return false
    if (!this.#speaker) return false
    this.#activeOperations += 1
    try {
      const stopping = this.#stopMedia()
      if (stopping) await stopping
      return await this.#speaker.play(buffer)
    } finally {
      this.#activeOperations -= 1
    }
  }

  async close(): Promise<void> {
    this.#closed = true
    const utterance = this.#utterance
    utterance?.cancel()
    try {
      const stopping = this.#stopMedia()
      if (stopping) await stopping
    } finally {
      try {
        this.#microphone?.stop()
      } finally {
        if ('stream' in this.#speechPlayback) {
          this.#speechPlayback.onPlayed = noop
          this.#speechPlayback.onDone = noop
        }
        await utterance?.done.catch((error: unknown) => {
          if (!(error instanceof Error && 'code' in error && error.code === 'cancelled')) throw error
        })
      }
    }
  }
}
