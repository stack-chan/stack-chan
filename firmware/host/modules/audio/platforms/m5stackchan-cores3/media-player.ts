import MP3Streamer from 'buffered-mp3streamer'
import type { HTTPClientProvider } from 'embedded:network/http/client'
import type { MediaCapability, MediaProgress, MediaStartOptions, MediaState } from 'capabilities'
import Timer from 'timer'
import { URL } from 'url'
import WebRadioAudioOut from 'web-radio-audio-out'

type NetworkTransport = HTTPClientProvider
type Session = { audio: WebRadioAudioOut; streamer?: MP3Streamer; generation: number }

declare const device: {
  network: {
    http: { client: NetworkTransport }
    https: { client: NetworkTransport }
  }
}

const BACKOFF_SECONDS = [1, 2, 4, 8, 16, 30] as const
const STALL_TIMEOUT_MS = 10_000
const MAX_WEB_RADIO_VOLUME = 0.2
const DECODED_PCM_SAMPLE_RATE = 44100
const OUTPUT_PCM_SAMPLE_RATE = 24000

function checkedVolume(volume: number): number {
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) throw new Error('Volume must be between 0 and 1')
  if (volume > MAX_WEB_RADIO_VOLUME) {
    trace(`[web-radio] volume ${volume} limited to ${MAX_WEB_RADIO_VOLUME}\n`)
    return MAX_WEB_RADIO_VOLUME
  }
  return volume
}

export default class MediaPlayer implements MediaCapability {
  #state: MediaState = 'idle'
  #options: MediaStartOptions | undefined
  #session: Session | undefined
  #reconnectTimer: ReturnType<typeof Timer.set> | undefined
  #stallTimer: ReturnType<typeof Timer.set> | undefined
  #backoffIndex = 0
  #generation = 0
  #volume = MAX_WEB_RADIO_VOLUME
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
    this.#options?.onProgress?.(this.progress)
  }

  pause(): void {
    if (this.#options?.mode !== 'finite' || this.#state === 'paused' || this.#state === 'ended') return
    this.#position = this.progress.position
    this.#stopped = true
    this.#generation++
    this.#clearTimers()
    this.#closeSession()
    this.#setState('paused')
    this.#emitProgress()
  }

  async resume(): Promise<void> {
    if (this.#state !== 'paused' || !this.#options) return
    this.#stopped = false
    this.#openSession()
  }

  async seek(seconds: number): Promise<void> {
    if (this.#options?.mode !== 'finite') throw new Error('Seek requires finite playback')
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid seek position')
    const paused = this.#state === 'paused'
    const generation = ++this.#generation
    this.#clearTimers()
    this.#closeSession()
    this.#position = this.#duration ? Math.min(seconds, this.#duration) : seconds
    this.#base = this.#position
    this.#emitProgress()
    if (paused || generation !== this.#generation) return
    this.#stopped = false
    this.#openSession()
  }

  get state(): MediaState {
    return this.#state
  }

  async start(options: MediaStartOptions): Promise<void> {
    this.#validateOptions(options)
    const generation = this.#generation
    this.stop()
    if (this.#generation !== generation + 1) return
    this.#options = { ...options, reconnect: options.mode === 'live' && (options.reconnect ?? true) }
    this.#duration = options.duration
    this.#estimated = !!options.duration
    this.#volume = checkedVolume(options.volume ?? MAX_WEB_RADIO_VOLUME)
    this.#stopped = false
    this.#setState('connecting')
    if (this.#generation !== generation + 1 || this.#stopped) return
    this.#openSession()
  }

  stop(): void {
    this.#stopped = true
    this.#generation += 1
    this.#clearTimers()
    this.#closeSession()
    this.#backoffIndex = 0
    this.#hasPlayed = false
    this.#position = this.#base = 0
    this.#duration = undefined
    this.#estimated = false
    this.#points = []
    this.#pointSpacing = 5
    this.#source = undefined
    const options = this.#options
    this.#options = undefined
    const changed = this.#state !== 'idle'
    this.#state = 'idle'
    const generation = this.#generation
    options?.onProgress?.(this.progress)
    if (changed && generation === this.#generation) options?.onStateChanged?.('idle')
  }

  close(): void {
    this.stop()
  }

  setVolume(volume: number): void {
    this.#volume = checkedVolume(volume)
    this.#session?.audio.enqueue(0, WebRadioAudioOut.Volume, Math.round(this.#volume * 256))
  }

  #validateOptions(options: MediaStartOptions): void {
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

  /** Start a new radio playback generation using the URL-appropriate HTTP provider. */
  #openSession(): void {
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
      const audio = new WebRadioAudioOut({
        streams: 1,
        bitsPerSample: 16,
        numChannels: 1,
        sampleRate: OUTPUT_PCM_SAMPLE_RATE,
      })
      const session: Session = { audio, generation }
      this.#session = session
      if (options.mode === 'finite') this.#progressTimer = Timer.repeat(() => this.#emitProgress(), 250)
      audio.enqueue(0, WebRadioAudioOut.Volume, Math.round(this.#volume * 256))
      this.#setState(this.#backoffIndex > 0 ? 'retrying' : 'buffering')
      if (!this.#isCurrent(generation)) return
      const path = `${url.pathname}${url.search}` || '/'
      session.streamer = new MP3Streamer({
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
      this.#generation += 1
      this.#clearTimers()
      this.#closeSession()
      this.#setState('ended')
      this.#emitProgress()
    } catch (error) {
      this.#fail(generation, String(error))
    }
  }

  #onReady(generation: number, ready: boolean): void {
    if (!this.#isCurrent(generation)) return
    this.#clearStallTimer()
    if (ready) {
      this.#session?.audio.start()
      if (!this.#isCurrent(generation)) return
      this.#backoffIndex = 0
      this.#setState('buffering')
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
    this.#closeSession()
    if (this.#stopped || !this.#options?.reconnect) {
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
    return !this.#stopped && this.#generation === generation
  }

  #closeSession(): void {
    const session = this.#session
    this.#session = undefined
    if (!session) return
    try {
      session.streamer?.close()
    } catch (error) {
      trace(`WebRadio streamer close failed: ${String(error)}\n`)
    }
    try {
      session.audio.enqueue(0, WebRadioAudioOut.Flush)
      session.audio.stop()
    } catch (error) {
      trace(`WebRadio audio stop failed: ${String(error)}\n`)
    }
    try {
      session.audio.close()
    } catch (error) {
      trace(`WebRadio audio close failed: ${String(error)}\n`)
    }
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
    this.#options?.onStateChanged?.(state, reason)
  }
}
