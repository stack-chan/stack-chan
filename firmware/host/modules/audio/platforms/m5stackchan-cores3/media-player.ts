import type { HTTPClientProvider } from 'embedded:network/http/client'
import MP3Streamer from 'buffered-mp3streamer'
import type {
  FiniteMediaSession,
  FiniteMediaSource,
  LiveMediaSource,
  MediaCapability,
  MediaOpenOptions,
  MediaProgress,
  MediaSession,
  MediaStartOptions,
  MediaState,
} from 'capabilities'
import type { Speaker } from 'stackchan/voice/contracts'
import { mono } from 'stackchan/voice/media'
import { createVoiceScope, deferred, requireActive } from 'stackchan/voice/scope'
import Timer from 'timer'
import { URL } from 'url'
import { MAX_MEDIA_VOLUME } from 'volume-model'
import WebRadioAudioOut from 'web-radio-audio-out'

type NetworkTransport = HTTPClientProvider
type Session = { audio: WebRadioAudioOut; streamer?: MP3Streamer }

declare const device: {
  network: {
    http: { client: NetworkTransport }
    https: { client: NetworkTransport }
  }
}

const BACKOFF_SECONDS = [1, 2, 4, 8, 16, 30] as const
const STALL_TIMEOUT_MS = 10_000
const DECODED_PCM_SAMPLE_RATE = 44100
const OUTPUT_PCM_SAMPLE_RATE = 24000

function checkedVolume(volume: number): number {
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) throw new Error('Volume must be between 0 and 1')
  if (volume > MAX_MEDIA_VOLUME) {
    trace(`[web-radio] volume ${volume} limited to ${MAX_MEDIA_VOLUME}\n`)
    return MAX_MEDIA_VOLUME
  }
  return volume
}

function validateOptions(options: MediaStartOptions): void {
  const url = new URL(options.url)
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error('WebRadio supports only HTTP and HTTPS URLs')
  if (url.username || url.password) throw new Error('URL credentials are not supported')
  if (options.mode !== 'live' && options.mode !== 'finite') throw new Error('Invalid media mode')
  if (options.mode === 'finite' && options.reconnect) throw new Error('Finite playback cannot reconnect')
  if (options.duration !== undefined && (!Number.isFinite(options.duration) || options.duration <= 0))
    throw new Error('Invalid duration')
  if (options.volume !== undefined) checkedVolume(options.volume)
}

class StreamSession {
  readonly result = deferred<'ended' | 'stopped'>()
  #getSpeaker: () => Speaker
  #attempt?: ReturnType<typeof createVoiceScope>
  #opening?: Promise<void>
  #closing: Promise<void> = Promise.resolve()
  #terminal = false
  constructor(getSpeaker: () => Speaker) {
    this.#getSpeaker = getSpeaker
    void this.result.promise.catch(() => {})
  }
  #state: MediaState = 'idle'
  #options: MediaStartOptions | undefined
  #session: Session | undefined
  #reconnectTimer: ReturnType<typeof Timer.set> | undefined
  #stallTimer: ReturnType<typeof Timer.set> | undefined
  #backoffIndex = 0
  #generation = 0
  #volume = MAX_MEDIA_VOLUME
  #stopped = true
  #hasPlayed = false
  #position = 0
  #base = 0
  #duration: number | undefined
  #estimated = false
  #progressTimer: ReturnType<typeof Timer.repeat> | undefined
  #points: { offset: number; seconds: number }[] = []
  #pointSpacing = 5
  #source: { url: string; totalBytes?: number; validator?: string } | undefined

  get progress(): MediaProgress {
    const position = this.#session ? this.#base + this.#session.audio.playedSeconds : this.#position
    return {
      position: this.#duration ? Math.min(position, this.#duration) : position,
      duration: this.#duration,
      estimated: this.#estimated,
      seekable: this.#options?.mode === 'finite' && !!this.#duration,
    }
  }

  #emitProgress(): void {
    try {
      this.#options?.onProgress?.(this.progress)
    } catch (error) {
      trace(`[media] progress listener: ${error}\n`)
    }
  }

  async pause(): Promise<void> {
    if (this.#options?.mode !== 'finite' || (this.#state === 'paused' && this.#stopped) || this.#terminal)
      return this.#closing
    this.#position = this.progress.position
    this.#stopped = true
    this.#generation++
    this.#clearTimers()
    const closing = this.#closeSession()
    this.#setState('paused')
    this.#emitProgress()
    await closing
  }

  async resume(): Promise<void> {
    if (this.#state !== 'paused' || !this.#options || !this.#stopped || this.#terminal) return
    this.#stopped = false
    await this.#openSession()
  }

  async seek(seconds: number): Promise<void> {
    if (this.#terminal) return
    if (this.#options?.mode !== 'finite') throw new Error('Seek requires finite playback')
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid seek position')
    const paused = this.#state === 'paused' && this.#stopped
    const generation = ++this.#generation
    this.#clearTimers()
    const closing = this.#closeSession()
    this.#position = this.#duration ? Math.min(seconds, this.#duration) : seconds
    this.#base = this.#position
    this.#emitProgress()
    await closing
    if (paused || generation !== this.#generation) return
    this.#stopped = false
    await this.#openSession()
  }

  get state(): MediaState {
    return this.#state
  }

  async start(options: MediaStartOptions): Promise<void> {
    if (this.#terminal) return
    const generation = this.#generation
    this.#options = { ...options, reconnect: options.mode === 'live' && (options.reconnect ?? true) }
    this.#duration = options.duration
    this.#estimated = !!options.duration
    this.#volume = checkedVolume(options.volume ?? MAX_MEDIA_VOLUME)
    this.#stopped = false
    this.#setState('connecting')
    if (this.#generation !== generation || this.#stopped) return
    await this.#openSession()
  }

  async stop(): Promise<void> {
    if (this.#terminal) return this.#closing
    this.#terminal = true
    this.#stopped = true
    this.#generation += 1
    this.#clearTimers()
    const closing = this.#closeSession()
    this.#backoffIndex = 0
    this.#hasPlayed = false
    this.#position = this.#base = 0
    this.#duration = undefined
    this.#estimated = false
    this.#points = []
    this.#pointSpacing = 5
    this.#source = undefined
    this.#emitProgress()
    this.#setState('idle')
    this.#options = undefined
    try {
      await closing
      this.result.resolve('stopped')
    } catch (error) {
      this.result.reject(error)
      throw error
    }
  }

  setVolume(volume: number): void {
    this.#volume = checkedVolume(volume)
    this.#session?.audio.setVolume(this.#volume)
  }

  /** Start a new radio playback generation using the URL-appropriate HTTP provider. */
  #openSession(): Promise<void> {
    const task = this.#connect()
    this.#opening = task
    return task
  }

  async #connect(): Promise<void> {
    const options = this.#options
    if (this.#stopped || !options) return
    const url = new URL(options.url)
    let point = { offset: 0, seconds: 0 }
    if (this.#source?.validator) {
      for (const candidate of this.#points) {
        if (candidate.seconds > Math.max(0, this.#position - 1)) break
        point = candidate
      }
    } else {
      // A later response may introduce a validator for replacement content.
      // Its checkpoints must not be mixed with positions from unverified bytes.
      this.#points = []
      this.#pointSpacing = 5
    }
    this.#base = this.#position
    const generation = ++this.#generation
    this.#hasPlayed = false
    try {
      await this.#closing
      if (!this.#isCurrent(generation)) return
      const scope = createVoiceScope()
      this.#attempt = scope
      const speaker = this.#getSpeaker()
      const lease = await speaker.runtime.acquirePlayback(speaker, [mono(OUTPUT_PCM_SAMPLE_RATE)], {
        ...scope,
        budget: { maxBufferedMs: 250, maxBufferedBytes: 24576 },
        interrupt: () => this.stop(),
      })
      if (!this.#isCurrent(generation)) {
        await lease.close()
        return
      }
      const audio = new WebRadioAudioOut(lease, (error) => this.#fail(generation, String(error)))
      const session: Session = { audio }
      this.#session = session
      this.#attempt = undefined
      if (options.mode === 'finite') this.#progressTimer = Timer.repeat(() => this.#emitProgress(), 250)
      audio.setVolume(this.#volume)
      this.#setState(this.#backoffIndex > 0 ? 'retrying' : 'buffering')
      if (!this.#isCurrent(generation)) return
      const path = `${url.pathname}${url.search}` || '/'
      const streamer = new MP3Streamer({
        protocol: url.protocol === 'https:' ? 'https' : 'http',
        http: url.protocol === 'https:' ? device.network.https.client : device.network.http.client,
        host: url.hostname,
        port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
        path,
        reconnect: options.reconnect,
        mode: options.mode,
        seek: options.mode === 'finite' ? { ...point, target: this.#position } : { offset: 0, seconds: 0, target: 0 },
        source: this.#source,
        onSource: (source, reset) => {
          if (!this.#isCurrent(generation)) return
          this.#source = source
          if (reset) {
            this.#points = []
            this.#pointSpacing = 5
          }
        },
        onCheckpoint: (point) => {
          if (!this.#isCurrent(generation)) return
          const last = this.#points[this.#points.length - 1]
          if (last && point.seconds < last.seconds + this.#pointSpacing) return
          if (this.#points.length >= 512) {
            this.#points = this.#points.filter((_point, index) => index % 2 === 0)
            this.#pointSpacing *= 2
          }
          this.#points.push(point)
        },
        onMetadata: (metadata) => {
          if (!this.#isCurrent(generation)) return
          if (!metadata.duration && this.#duration && !this.#estimated) return
          this.#duration = metadata.estimated
            ? (options.duration ?? metadata.duration)
            : (metadata.duration ?? options.duration)
          this.#estimated = metadata.estimated || (!metadata.duration && !!options.duration)
          this.#emitProgress()
        },
        onOutputStart: (seconds) => {
          if (!this.#isCurrent(generation)) return
          this.#base = seconds
          this.#emitProgress()
        },
        audio: { out: audio, stream: 0, sampleRate: DECODED_PCM_SAMPLE_RATE },
        onReady: (ready) => this.#onReady(generation, ready),
        onPlayed: () => this.#onPlayed(generation),
        onError: (reason) => this.#fail(generation, String(reason)),
        onDone: () => this.#onDone(generation),
      })
      if (this.#isCurrent(generation)) session.streamer = streamer
      else await streamer.close()
    } catch (error) {
      this.#fail(generation, String(error))
    }
  }

  async #onDone(generation: number): Promise<void> {
    if (!this.#isCurrent(generation)) return
    if (this.#options?.mode !== 'finite') {
      this.#fail(generation, 'stream ended')
      return
    }
    this.#clearStallTimer()
    try {
      // A seek to/beyond the last frame can end without any output samples.
      if (this.#hasPlayed) await this.#session?.audio.drain()
      if (!this.#isCurrent(generation)) return
      this.#position = this.#duration ?? this.progress.position
      this.#clearTimers()
      await this.#closeSession()
      if (!this.#isCurrent(generation)) return
      this.#terminal = true
      this.#setState('ended')
      this.result.resolve('ended')
      this.#emitProgress()
    } catch (error) {
      this.#fail(generation, String(error))
    }
  }

  #onReady(generation: number, ready: boolean): void {
    if (!this.#isCurrent(generation)) return
    this.#clearStallTimer()
    if (ready) {
      this.#backoffIndex = 0
      this.#setState('buffering')
      if (!this.#isCurrent(generation)) return
      try {
        this.#session?.audio.start()
      } catch (error) {
        this.#fail(generation, String(error))
        return
      }
      return
    }
    // The onWritable completion means that a buffer has entered I2S/DMA, not
    // that the speaker has played it. Keep AudioOut running so an underrun does
    // not discard audio that is still resident in DMA.
    this.#setState(this.#hasPlayed ? 'stalled' : 'buffering')
    if (!this.#isCurrent(generation)) return
    this.#stallTimer = Timer.set(() => this.#fail(generation, 'stream stalled'), STALL_TIMEOUT_MS)
  }

  #onPlayed(generation: number): void {
    if (!this.#isCurrent(generation)) return
    this.#hasPlayed = true
    this.#setState('playing')
  }

  #fail(generation: number, reason: string): void {
    if (!this.#isCurrent(generation)) return
    if (this.#options?.mode === 'finite') this.#position = this.progress.position
    this.#generation += 1
    this.#clearTimers()
    const closing = this.#closeSession()
    if (this.#stopped || !this.#options?.reconnect) {
      this.#terminal = true
      void closing.then(
        () => this.result.reject(new Error(reason)),
        (error) => this.result.reject(error),
      )
      this.#setState('error', reason)
      return
    }
    const delay = BACKOFF_SECONDS[Math.min(this.#backoffIndex, BACKOFF_SECONDS.length - 1)] * 1000
    this.#backoffIndex += 1
    const retryGeneration = this.#generation
    this.#setState('retrying', reason)
    if (!this.#isCurrent(retryGeneration)) return
    this.#reconnectTimer = Timer.set(() => {
      this.#reconnectTimer = undefined
      this.#openSession()
    }, delay)
  }

  #isCurrent(generation: number): boolean {
    return !this.#terminal && !this.#stopped && this.#generation === generation
  }

  #closeSession(): Promise<void> {
    const session = this.#session
    const opening = this.#opening
    this.#session = this.#opening = undefined
    this.#attempt?.abort()
    this.#attempt = undefined
    const previous = this.#closing
    this.#closing = (async () => {
      try {
        await session?.streamer?.close()
      } finally {
        try {
          await session?.audio.close()
        } finally {
          await opening
          await previous
        }
      }
    })()
    void this.#closing.catch((error) => {
      if (this.#terminal) return
      this.#terminal = true
      this.result.reject(error)
      this.#setState('error', String(error))
    })
    return this.#closing
  }

  #clearStallTimer(): void {
    if (this.#stallTimer !== undefined) Timer.clear(this.#stallTimer)
    this.#stallTimer = undefined
  }

  #clearTimers(): void {
    if (this.#progressTimer !== undefined) Timer.clear(this.#progressTimer)
    this.#progressTimer = undefined
    this.#clearStallTimer()
    if (this.#reconnectTimer !== undefined) Timer.clear(this.#reconnectTimer)
    this.#reconnectTimer = undefined
  }

  #setState(state: MediaState, reason?: string): void {
    if (this.#state === state && reason === undefined) return
    this.#state = state
    try {
      this.#options?.onStateChanged?.(state, reason)
    } catch (error) {
      trace(`[media] state listener: ${error}\n`)
    }
  }
}

export default class MediaPlayer implements MediaCapability {
  #getSpeaker: () => Speaker
  #current?: StreamSession
  #retiring: Promise<void> = Promise.resolve()

  constructor(getSpeaker: () => Speaker) {
    this.#getSpeaker = getSpeaker
  }

  get state() {
    return this.#current?.state ?? 'idle'
  }
  get progress(): MediaProgress {
    return this.#current?.progress ?? { position: 0, estimated: false, seekable: false }
  }

  open(source: LiveMediaSource, options: MediaOpenOptions): Promise<MediaSession>
  open(source: FiniteMediaSource, options: MediaOpenOptions): Promise<FiniteMediaSession>
  async open(source: LiveMediaSource | FiniteMediaSource, options: MediaOpenOptions): Promise<MediaSession> {
    const settings = { ...options, ...source }
    requireActive(options.signal)
    validateOptions(settings)
    const previous = this.#current
    const stream = new StreamSession(this.#getSpeaker)
    this.#current = stream
    const retired = this.#retire(previous)
    const stop = () => stream.stop()
    const abort = () => {
      void stop().catch(() => {})
    }
    options.signal.addEventListener('abort', abort)
    const detach = () => options.signal.removeEventListener('abort', abort)
    const done = stream.result.promise
    void done.then(detach, detach)
    try {
      await retired
      requireActive(options.signal)
      if (this.#current === stream) await stream.start(settings)
    } catch (error) {
      await stop()
      throw error
    }
    const session: MediaSession = {
      get state() {
        return stream.state
      },
      get progress() {
        return stream.progress
      },
      done,
      stop,
      setVolume: (volume) => stream.setVolume(volume),
    }
    return source.mode === 'live'
      ? session
      : Object.assign(session, {
          pause: () => stream.pause(),
          resume: () => stream.resume(),
          seek: (seconds: number) => stream.seek(seconds),
        })
  }

  #retire(stream?: StreamSession) {
    if (stream) {
      const stopped = deferred<void>()
      this.#retiring = Promise.all([this.#retiring, stopped.promise]).then(() => {})
      void stream.stop().then(stopped.resolve, stopped.reject)
    }
    return this.#retiring
  }
  async start(options: MediaStartOptions) {
    validateOptions(options)
    const settings = { ...options, ...createVoiceScope() }
    if (options.mode === 'live')
      await this.open({ mode: 'live', url: options.url, reconnect: options.reconnect }, settings)
    else await this.open({ mode: 'finite', url: options.url, duration: options.duration }, settings)
  }
  pause() {
    return this.#current?.pause()
  }
  async resume() {
    await this.#current?.resume()
  }
  async seek(seconds: number) {
    if (!this.#current) throw new Error('Seek requires finite playback')
    await this.#current.seek(seconds)
  }
  stop() {
    const stream = this.#current
    this.#current = undefined
    return this.#retire(stream)
  }
  close() {
    return this.stop()
  }
  setVolume(volume: number) {
    const gain = checkedVolume(volume)
    this.#current?.setVolume(gain)
  }
}
