import type { BorrowedAudioBuffer, OwnedAudioBuffer } from 'audio-buffer'
import type { TTS, WebRadioCapability, WebRadioStartOptions } from 'capabilities'
import type Microphone from 'microphone'
import { OperationQueue } from 'operation-queue'
import type Speaker from 'speaker'
import type { CapabilityStatus, PlaybackOptions } from 'stackchan/app'
import { finiteNumber, StackchanError } from 'stackchan/errors'
import type { CancellationSignal } from 'stackchan/task'
import { type Maybe, noop, waitForCompletion } from 'stackchan-util'
import Timer from 'timer'

export type RuntimeAudioConstructorParam = {
  tts: TTS
  clipPlayer?: TTS
  ttsKind?: 'speech' | 'clips' | 'unavailable'
  simulated?: boolean
  microphone?: Pick<Microphone, 'record' | 'stop'>
  speaker?: Pick<Speaker, 'tone' | 'play'> & { cancelPlayback?: (reason?: unknown) => void; close?: () => void }
  webRadio?: WebRadioCapability
}

type RuntimeAudioOptions = {
  onMouthOpenChanged?: (value: number) => void
}

export class StackchanRuntimeAudio {
  #microphone: RuntimeAudioConstructorParam['microphone']
  #options: RuntimeAudioOptions
  #speaker: RuntimeAudioConstructorParam['speaker']
  #tts: TTS
  #clips: TTS | undefined
  #webRadio: WebRadioCapability | undefined
  #closed = false
  #ttsKind: NonNullable<RuntimeAudioConstructorParam['ttsKind']>
  #simulated: boolean
  #output = new OperationQueue({
    clock: {
      after(milliseconds, callback) {
        const timer = Timer.set(callback, milliseconds)
        return () => Timer.clear(timer)
      },
    },
  })
  #input = new OperationQueue({
    clock: {
      after(milliseconds, callback) {
        const timer = Timer.set(callback, milliseconds)
        return () => Timer.clear(timer)
      },
    },
  })

  constructor(params: RuntimeAudioConstructorParam, options: RuntimeAudioOptions = {}) {
    this.#options = options
    this.#ttsKind = params.ttsKind ?? 'speech'
    this.#clips = params.clipPlayer ?? (this.#ttsKind === 'clips' ? params.tts : undefined)
    this.#simulated = params.simulated ?? false
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
        if (runtime.#closed) return Promise.reject(new StackchanError('CLOSED', 'Audio is closed'))
        if (runtime.#output.busy) return Promise.reject(new StackchanError('BUSY', 'audio busy'))
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
    if (this.#closed) throw new StackchanError('CLOSED', 'Audio is closed')
    if (this.#output.busy) throw new StackchanError('BUSY', 'Cannot replace TTS during playback')
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
      await this.speak(text, { volume }, false)
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

  audioStatus(kind: 'speech' | 'clips' | 'tone'): CapabilityStatus {
    const available = kind === 'tone' ? !!this.#speaker : kind === 'clips' ? !!this.#clips : this.#ttsKind === kind
    return available
      ? { availability: this.#simulated ? 'simulated' : 'native' }
      : { availability: 'unavailable', reason: `Audio ${kind} is unavailable with the selected provider` }
  }

  async speak(text: string, options: PlaybackOptions = {}, validateKind = true): Promise<void> {
    if (this.#closed) throw new StackchanError('CLOSED', 'Audio is closed')
    if (validateKind && this.#ttsKind !== 'speech')
      throw new StackchanError('UNSUPPORTED', 'Select a speech provider to speak text')
    await this.#stream(text, options)
  }

  async playClip(name: string, options: PlaybackOptions = {}): Promise<void> {
    if (this.#closed) throw new StackchanError('CLOSED', 'Audio is closed')
    if (!this.#clips) throw new StackchanError('UNSUPPORTED', 'The selected provider does not play resource clips')
    if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(name))
      throw new StackchanError('INVALID_ARGUMENT', 'Use a clip resource name without an extension')
    await this.#stream(name, options, this.#clips)
  }

  async #stream(text: string, options: PlaybackOptions, provider: TTS = this.#tts): Promise<void> {
    if (typeof text !== 'string' || text.length === 0 || text.length > 4096)
      throw new StackchanError('INVALID_ARGUMENT', 'Speech must be 1–4096 characters')
    if (options.volume !== undefined) finiteNumber(options.volume, 'volume', 0, 1)
    await this.#output.run(
      () => {
        this.#webRadio?.stop()
        return waitForCompletion((callback) => provider.stream(text, options.volume, callback))
      },
      (reason) => provider.cancelPlayback?.(reason),
      options.signal,
    )
  }

  async sing(koe: string, volume?: number): Promise<Maybe<string>> {
    try {
      if (volume !== undefined) finiteNumber(volume, 'volume', 0, 1)
      await this.#output.run(
        () => {
          this.#webRadio?.stop()
          const tts = this.#tts
          if (!tts.streamKoe) throw new StackchanError('UNSUPPORTED', 'The active TTS does not support singing.')
          return waitForCompletion((callback) => tts.streamKoe(koe, volume, callback))
        },
        (reason) => this.#tts.cancelPlayback?.(reason),
      )
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
    }
  }

  async record(durationMilliSec?: number): Promise<OwnedAudioBuffer> {
    if (!this.#microphone) {
      throw new StackchanError('UNSUPPORTED', 'This device does not support a microphone.')
    }
    if (durationMilliSec !== undefined) finiteNumber(durationMilliSec, 'durationMs', 1, 60_000)
    return this.#input.run(
      () => this.#microphone.record(durationMilliSec),
      () => this.#microphone?.stop(),
    )
  }

  async tone(hz: number, duration: number, volume?: number, signal?: CancellationSignal): Promise<void> {
    if (this.#closed) throw new StackchanError('CLOSED', 'Audio is closed')
    finiteNumber(hz, 'hz', 1, 24_000)
    finiteNumber(duration, 'durationMs', 0, 60_000)
    if (volume !== undefined) finiteNumber(volume, 'volume', 0, 1)
    if (!this.#speaker) throw new StackchanError('UNSUPPORTED', 'This device does not support tone playback')
    await this.#output.run(
      () => {
        this.#webRadio?.stop()
        return this.#speaker.tone(hz, duration, volume)
      },
      (reason) => this.#speaker?.cancelPlayback?.(reason),
      signal,
    )
  }

  async playAudio(buffer: BorrowedAudioBuffer): Promise<boolean> {
    if (!this.#speaker) return false
    return this.#output.run(
      () => {
        this.#webRadio?.stop()
        return this.#speaker.play(buffer)
      },
      (reason) => this.#speaker?.cancelPlayback?.(reason),
    )
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#tts.onPlayed = noop
    this.#tts.onDone = noop
    this.#output.close()
    this.#input.close()
    let firstError: unknown
    let failed = false
    for (const cleanup of [
      () => this.#webRadio?.stop(),
      () => this.#microphone?.stop(),
      () => this.#speaker?.close?.(),
    ]) {
      try {
        cleanup()
      } catch (error) {
        if (!failed) {
          firstError = error
          failed = true
        }
      }
    }
    if (failed) throw firstError
  }
}
