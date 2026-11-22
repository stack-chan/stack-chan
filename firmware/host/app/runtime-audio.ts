import type { BorrowedAudioBuffer, OwnedAudioBuffer } from 'audio-buffer'
import type {
  FiniteMediaSession,
  FiniteMediaSource,
  LiveMediaSource,
  MediaCapability,
  MediaOpenOptions,
  MediaSession,
  MediaStartOptions,
  SpeechPlayback,
  WebRadioCapability,
  WebRadioStartOptions,
} from 'capabilities'
import type Microphone from 'microphone'
import type Speaker from 'speaker'
import type { SpeakerSpeechPlayback, UtterancePlayback } from 'speech-playback-types'
import type { AudioLevel, Speaker as VoiceSpeaker } from 'stackchan/voice/contracts'
import { type Maybe, noop, waitForCompletion } from 'stackchan-util'
import { DEFAULT_VOLUME, MAX_MEDIA_VOLUME } from 'volume-model'

type StandalonePlayback = SpeechPlayback | SpeakerSpeechPlayback
type LazySpeechPlayback = SpeechPlayback & { readonly playUtterance?: SpeakerSpeechPlayback['playUtterance'] }

export function lazySpeechPlayback(create: () => StandalonePlayback): LazySpeechPlayback {
  let playback: StandalonePlayback | undefined
  function getPlayback() {
    if (!playback) {
      const created = create()
      if ('stream' in created) {
        created.onPlayed = (power) => lazy.onPlayed?.(power)
        created.onDone = () => lazy.onDone?.()
      }
      playback = created
    }
    return playback
  }
  const lazy: LazySpeechPlayback = {
    get playUtterance() {
      const player = getPlayback()
      return 'playUtterance' in player ? player.playUtterance.bind(player) : undefined
    },
    stream(text, volume, callback) {
      const player = getPlayback()
      if (!('stream' in player)) throw new Error('The active speech player requires a speaker lease.')
      player.stream(text, volume, callback)
    },
    streamKoe(koe, volume, callback) {
      const player = getPlayback()
      if (!('stream' in player) || !player.streamKoe)
        throw new Error('The active speech player does not support singing.')
      player.streamKoe(koe, volume, callback)
    },
  }
  return lazy
}

export type RuntimeAudioConstructorParam = {
  speechPlayback: StandalonePlayback
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
  #speechPlayback: StandalonePlayback
  #webRadio: WebRadioCapability | undefined
  #media: MediaCapability | undefined
  #activeOperations = 0
  #utterance?: Promise<UtterancePlayback>
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
    this.#speechPlayback = params.speechPlayback
    this.setSpeechPlayback(params.speechPlayback)
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

  get #unavailable() {
    return this.#closed || this.#exclusive || this.#utterance !== undefined
  }

  get #busy() {
    return this.#unavailable || this.#activeOperations > 0
  }

  #stopMedia() {
    const stopped = this.#media?.stop()
    const radio = this.#webRadio?.stop()
    if (stopped && radio) return Promise.all([stopped, radio]).then(() => {})
    return stopped || radio
  }

  acquireExclusive(
    kind: 'conversation' | 'playback' = 'conversation',
    interruptible = false,
  ): (() => void) | Promise<() => void> {
    if (
      this.#closed ||
      this.#exclusive ||
      this.#activeOperations ||
      this.#microphone?.recording ||
      (this.#utterance && (kind === 'conversation' || interruptible))
    )
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
    function requireAvailable() {
      if (runtime.#busy) throw new Error('audio busy')
    }
    function open(source: LiveMediaSource, options: MediaOpenOptions): Promise<MediaSession>
    function open(source: FiniteMediaSource, options: MediaOpenOptions): Promise<FiniteMediaSession>
    async function open(source: LiveMediaSource | FiniteMediaSource, options: MediaOpenOptions) {
      requireAvailable()
      const settings = {
        ...options,
        volume: options.volume ?? (runtime.#volume === undefined ? undefined : runtime.#volume * MAX_MEDIA_VOLUME),
      }
      if (source.mode === 'live') return player.open(source, settings)
      const session = await player.open(source, settings)
      return {
        get state() {
          return session.state
        },
        get progress() {
          return session.progress
        },
        done: session.done,
        setVolume: (volume: number) => session.setVolume(volume),
        stop: () => session.stop(),
        pause: () => session.pause(),
        async resume() {
          requireAvailable()
          await session.resume()
        },
        async seek(seconds: number) {
          requireAvailable()
          await session.seek(seconds)
        },
      }
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
      async resume() {
        requireAvailable()
        await media.resume()
      },
      async seek(seconds: number) {
        requireAvailable()
        await media.seek(seconds)
      },
      async start(options: MediaStartOptions) {
        requireAvailable()
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
        if (runtime.#busy) return Promise.reject(new Error('audio busy'))
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

  setSpeechPlayback(speechPlayback: StandalonePlayback): StandalonePlayback {
    if (this.#busy) throw new Error('audio busy')
    const previous = this.#speechPlayback
    if ('stream' in previous) {
      previous.onDone = noop
      previous.onPlayed = noop
    }
    this.#speechPlayback = speechPlayback
    if ('stream' in speechPlayback) {
      speechPlayback.onPlayed = this.#onPlayed
      speechPlayback.onDone = () => this.#onPlayed(0)
    }
    return previous
  }

  #onPlayed = (power: number) => {
    try {
      this.#options.onMouthOpenChanged?.(Math.min(power / 2000, 1))
    } catch {}
  }

  #onLevel = (level: AudioLevel) => {
    if (level.direction === 'output') this.#onPlayed(level.value * 32768)
  }

  say(text: string, volume?: number) {
    return this.#speak('text', text, volume)
  }

  sing(koe: string, volume?: number) {
    return this.#speak('koe', koe, volume)
  }

  async #speak(kind: 'text' | 'koe', text: string, volume?: number): Promise<Maybe<string>> {
    if (this.#unavailable) return { success: false, reason: 'audio busy' }
    const playback = this.#speechPlayback
    const gain = volume ?? this.#volume
    try {
      const play = 'playUtterance' in playback ? playback.playUtterance : undefined
      if (play) {
        const starting = Promise.resolve().then(() => {
          if (this.#closed) throw new Error('audio closed')
          const speaker = this.#options.getVoiceSpeaker?.()
          if (!speaker) throw new Error('speaker unavailable')
          return play.call(playback, speaker, kind, text, gain, this.#onLevel)
        })
        this.#utterance = starting
        try {
          await (await starting).done
        } finally {
          this.#onPlayed(0)
          this.#utterance = undefined
        }
      } else if ('stream' in playback) {
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
    if (this.#unavailable) throw new Error('audio busy')
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
    if (this.#unavailable) throw new Error('audio busy')
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
    if (this.#unavailable) return false
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
    const closing = this.#utterance?.then(
      (utterance) => utterance.close(),
      () => {},
    )
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
        await closing
      }
    }
  }
}
