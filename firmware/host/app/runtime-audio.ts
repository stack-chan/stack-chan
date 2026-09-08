import { AppAudioSession } from 'app-audio-session'
import type { BorrowedAudioBuffer, OwnedAudioBuffer } from 'audio-buffer'
import type { AudioInputPort, AudioOutputPort } from 'audio-ports'
import type { TTS, WebRadioCapability, WebRadioStartOptions } from 'capabilities'
import { OperationQueue } from 'operation-queue'
import { OwnedResources, ResourceScope } from 'owned-resources'
import { isWaveMimeType, recordedAudio, validateAudioData } from 'recorded-audio'
import { DEFAULT_RECORDING_DURATION_MS, validateRecordingDuration } from 'recording-wave'
import { ownMicrophone, ownTTS, ownWebRadio } from 'runtime-resources'
import type { CapabilityStatus, PlaybackOptions } from 'stackchan/app'
import type { AudioData, RecordedAudio, RecordingOptions } from 'stackchan/audio'
import { asStackchanError, finiteNumber, StackchanError } from 'stackchan/errors'
import type { CancellationSignal } from 'stackchan/task'
import { MAX_TONE_DURATION_MS, MAX_TONE_HZ, MIN_TONE_HZ } from 'stackchan-contracts/audio-playback'
import { type Maybe, waitForCompletion } from 'stackchan-util'
import Timer from 'timer'
import { playbackReleaseFailure } from 'tts-playback-session'

export type RuntimeAudioConstructorParam = {
  tts: TTS
  clipPlayer?: TTS
  ttsKind?: 'speech' | 'clips' | 'unavailable'
  simulated?: boolean
  microphone?: AudioInputPort
  speaker?: AudioOutputPort
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
  #streamInput = false
  #streamOutput = false
  #streamFailure: StackchanError | undefined
  reserveStream(input: boolean, output: boolean): () => void {
    if (this.#closed) throw new StackchanError('CLOSED', 'Audio is closed')
    if (this.#streamFailure) throw this.#streamFailure
    if (this.#releaseFailure) throw this.#releaseFailure
    if (
      (input && (this.#streamInput || this.#input.busy || this.#input.closed)) ||
      (output && (this.#streamOutput || this.#output.busy || this.#output.closed))
    )
      throw new StackchanError('BUSY', 'Audio device is in use')
    if (input) this.#streamInput = true
    if (output) this.#streamOutput = true
    let released = false
    return () => {
      if (released) return
      released = true
      if (input) this.#streamInput = false
      if (output) this.#streamOutput = false
    }
  }
  failStream(error: unknown): void {
    this.#streamFailure = asStackchanError(error)
  }
  get streamingRadio(): WebRadioCapability | undefined {
    return this.#webRadio
  }
  #closed = false
  #devices: ResourceScope
  #shutdown: OwnedResources | undefined
  #releaseTTS: (() => void) | undefined
  #providers = new Set<TTS>()
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

  constructor(params: RuntimeAudioConstructorParam, options: RuntimeAudioOptions = {}, devices?: ResourceScope) {
    this.#options = options
    this.#ttsKind = params.ttsKind ?? 'speech'
    this.#clips = params.clipPlayer ?? (this.#ttsKind === 'clips' ? params.tts : undefined)
    this.#simulated = params.simulated ?? false
    this.#microphone = params.microphone
    this.#speaker = params.speaker
    this.#webRadio = params.webRadio
    this.#devices = devices ?? new ResourceScope()
    this.#providers.add(params.tts)
    if (params.clipPlayer) this.#providers.add(params.clipPlayer)
    if (!devices) {
      for (const provider of this.#providers) ownTTS(this.#devices, provider)
      if (params.microphone) ownMicrophone(this.#devices, params.microphone)
      if (params.speaker) this.#devices.defer(() => params.speaker.close?.())
      if (params.webRadio) ownWebRadio(this.#devices, params.webRadio)
    }
    try {
      this.useTTS(params.tts)
    } catch (error) {
      void this.close().catch((cleanupError) => trace(`[audio] cleanup failed: ${String(cleanupError)}\n`))
      throw error
    }
  }

  get microphone() {
    return this.#microphone
  }

  get #releaseFailure(): StackchanError | undefined {
    return this.#streamFailure ?? this.#output.failure ?? this.#input.failure ?? this.#microphone?.releaseFailure
  }

  createAppSession(): AppAudioSession {
    if (this.#closed) throw new StackchanError('CLOSED', 'Audio is closed')
    const runtime = this
    return new AppAudioSession({
      say: (text, options) => this.speak(text, options),
      playClip: (name, options) => this.playClip(name, options),
      tone: (hz, options) => this.tone(hz, options.durationMs, options.volume, options.signal),
      record: (options) => this.recordAudio(options),
      play: (audio, options) => this.play(audio, options),
      get releaseFailure() {
        return runtime.#releaseFailure
      },
    })
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
    if (this.#tts === tts) return
    this.#releaseTTS?.()
    if (!this.#providers.has(tts)) {
      ownTTS(this.#devices, tts)
      this.#providers.add(tts)
    }
    this.#tts = tts
    const previousPlayed = tts.onPlayed
    const previousDone = tts.onDone
    let active = true
    const played = (volume: number) => {
      if (!active || this.#closed) return
      this.#options.onMouthOpenChanged?.(volume === 0 ? 0 : Math.min(volume / 2000, 1.0))
    }
    const done = () => {
      if (!active || this.#closed) return
      this.#options.onMouthOpenChanged?.(0)
    }
    this.#releaseTTS = () => {
      if (!active) return
      active = false
      try {
        if (tts.onPlayed === played) tts.onPlayed = previousPlayed
      } finally {
        if (tts.onDone === done) tts.onDone = previousDone
      }
    }
    tts.onPlayed = played
    tts.onDone = done
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

  audioStatus(kind: 'speech' | 'clips' | 'tone' | 'recording' | 'playback'): CapabilityStatus {
    if (this.#releaseFailure) return { availability: 'unavailable', reason: 'Audio resources could not be released' }
    if (kind === 'recording') {
      let available = !this.#closed && !this.#input.closed && !!this.#microphone
      try {
        available &&= this.#microphone.available !== false && !this.#microphone.releaseFailure
      } catch {
        available = false
      }
      return available
        ? { availability: this.#simulated ? 'simulated' : 'native' }
        : { availability: 'unavailable', reason: 'Audio recording is unavailable with the selected input' }
    }
    if (this.#closed || this.#output.closed)
      return {
        availability: 'unavailable',
        reason: this.#output.failure ? 'Audio output could not be released' : 'Audio is closed',
      }
    const provider =
      kind === 'tone' || kind === 'playback'
        ? this.#speaker
        : kind === 'clips'
          ? this.#clips
          : this.#ttsKind === kind
            ? this.#tts
            : undefined
    let available = !!provider
    try {
      if (provider?.available) available = provider.available()
    } catch {
      available = false
    }
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
    await this.#runOutput(
      provider,
      () => waitForCompletion((callback) => provider.stream(text, options.volume, callback)),
      options.signal,
    )
  }

  async sing(koe: string, volume?: number): Promise<Maybe<string>> {
    try {
      if (volume !== undefined) finiteNumber(volume, 'volume', 0, 1)
      const tts = this.#tts
      await this.#runOutput(tts, () => {
        if (!tts.streamKoe) throw new StackchanError('UNSUPPORTED', 'The active TTS does not support singing.')
        return waitForCompletion((callback) => tts.streamKoe(koe, volume, callback))
      })
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

  async record(
    durationMilliSec = DEFAULT_RECORDING_DURATION_MS,
    signal?: CancellationSignal,
  ): Promise<OwnedAudioBuffer> {
    if (this.#closed) throw new StackchanError('CLOSED', 'Audio is closed')
    if (this.#streamFailure) throw this.#streamFailure
    if (this.#streamInput) throw new StackchanError('BUSY', 'Microphone is in use by a stream')
    const microphone = this.#microphone
    if (!microphone) {
      throw new StackchanError('UNSUPPORTED', 'This device does not support a microphone.')
    }
    validateRecordingDuration(durationMilliSec)
    if (microphone.releaseFailure) throw microphone.releaseFailure
    if (microphone.available === false) throw new StackchanError('UNSUPPORTED', 'Microphone recording is unavailable')
    const verifyRelease = () => {
      const failure = microphone.releaseFailure
      if (!failure) return
      // Do not transfer the shared input after an unconfirmed normal completion.
      void this.#input.fail(failure).catch(() => {})
      throw failure
    }
    return this.#input.run(
      async () => {
        let buffer: OwnedAudioBuffer
        try {
          buffer = await microphone.record(durationMilliSec)
        } catch (error) {
          verifyRelease()
          throw error
        }
        verifyRelease()
        return buffer
      },
      (reason) => microphone.stop(reason),
      signal,
    )
  }

  async recordAudio(options: RecordingOptions = {}): Promise<RecordedAudio> {
    const buffer = await this.record(options.durationMs, options.signal)
    return recordedAudio(buffer, this.#simulated)
  }

  async play(audio: AudioData, options: PlaybackOptions = {}): Promise<void> {
    if (this.#closed) throw new StackchanError('CLOSED', 'Audio is closed')
    validateAudioData(audio)
    if (options.volume !== undefined) finiteNumber(options.volume, 'volume', 0, 1)
    if (!this.#simulated && !isWaveMimeType(audio.mimeType))
      throw new StackchanError('UNSUPPORTED', 'This device plays PCM WAV buffers')
    const speaker = this.#speaker
    if (!speaker) throw new StackchanError('UNSUPPORTED', 'This device does not support buffer playback')
    await this.#runOutput(
      speaker,
      async () => {
        if ((await speaker.play(audio.data, options.volume)) !== true)
          throw new StackchanError('IO', 'Audio output did not confirm playback')
      },
      options.signal,
    )
  }

  async tone(hz: number, duration: number, volume?: number, signal?: CancellationSignal): Promise<void> {
    if (this.#closed) throw new StackchanError('CLOSED', 'Audio is closed')
    finiteNumber(hz, 'hz', MIN_TONE_HZ, MAX_TONE_HZ)
    finiteNumber(duration, 'durationMs', 0, MAX_TONE_DURATION_MS)
    if (volume !== undefined) finiteNumber(volume, 'volume', 0, 1)
    if (!this.#speaker) throw new StackchanError('UNSUPPORTED', 'This device does not support tone playback')
    const speaker = this.#speaker
    await this.#runOutput(speaker, () => speaker.tone(hz, duration, volume), signal)
  }

  async playAudio(buffer: BorrowedAudioBuffer): Promise<boolean> {
    if (this.#closed) throw new StackchanError('CLOSED', 'Audio is closed')
    if (!this.#speaker) return false
    const speaker = this.#speaker
    return this.#runOutput(speaker, () => speaker.play(buffer))
  }

  #runOutput<T>(
    provider: { cancelPlayback?: (reason?: unknown) => void | Promise<void> },
    start: () => T | Promise<T>,
    signal?: CancellationSignal,
  ): Promise<T> {
    if (this.#streamFailure) return Promise.reject(this.#streamFailure)
    if (this.#streamOutput) return Promise.reject(new StackchanError('BUSY', 'Output is in use by a stream'))
    let settled: Promise<void> | undefined
    const verifyRelease = () => {
      const failure = playbackReleaseFailure(provider)
      if (!failure) return
      // Fault before handing the shared device to another provider. Waiting
      // here would make this queue entry wait for its own cancellation.
      void this.#output.fail(failure).catch(() => {})
      throw failure
    }
    return this.#output.run(
      () => {
        this.#webRadio?.stop()
        const playback = (async () => {
          let result: T
          try {
            result = await start()
          } catch (error) {
            verifyRelease()
            throw error
          }
          verifyRelease()
          return result
        })()
        settled = playback.then(
          () => {},
          () => {},
        )
        return playback
      },
      (reason) => {
        const failure = playbackReleaseFailure(provider)
        if (failure) throw failure
        if (provider.cancelPlayback) return provider.cancelPlayback(reason)
        // A provider without cancellation must finish before its device can
        // transfer. OperationQueue bounds that wait and faults on timeout.
        return settled
      },
      signal,
    )
  }

  close(): Promise<void> {
    if (!this.#shutdown) {
      this.#closed = true
      this.#shutdown = new OwnedResources([
        () => this.#releaseTTS?.(),
        () => this.#output.close(),
        () => this.#input.close(),
        () => this.#devices.close(),
      ])
    }
    return this.#shutdown.close()
  }
}
