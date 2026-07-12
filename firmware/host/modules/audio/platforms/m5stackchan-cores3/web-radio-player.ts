import MP3Streamer from 'mp3streamer'
import type { WebRadioCapability, WebRadioStartOptions, WebRadioState } from 'capabilities'
import AudioOut from 'pins/audioout'
import Timer from 'timer'
import { URL } from 'url'

type NetworkTransport = new (options: never) => unknown
type Session = { audio: AudioOut; streamer?: MP3Streamer; generation: number }

declare const device: {
  network: {
    http: NetworkTransport
    https: NetworkTransport
  }
}

const BACKOFF_SECONDS = [1, 2, 4, 8, 16, 30] as const
const STALL_TIMEOUT_MS = 10_000

function checkedVolume(volume: number): number {
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) throw new Error('Volume must be between 0 and 1')
  return volume
}

export default class WebRadioPlayer implements WebRadioCapability {
  #state: WebRadioState = 'idle'
  #options: WebRadioStartOptions | undefined
  #session: Session | undefined
  #reconnectTimer: ReturnType<typeof Timer.set> | undefined
  #stallTimer: ReturnType<typeof Timer.set> | undefined
  #backoffIndex = 0
  #generation = 0
  #volume = 0.5
  #stopped = true
  #hasPlayed = false

  get state(): WebRadioState {
    return this.#state
  }

  async start(options: WebRadioStartOptions): Promise<void> {
    this.#validateOptions(options)
    this.stop()
    this.#options = { ...options, sampleRate: options.sampleRate ?? 44100, reconnect: options.reconnect ?? true }
    this.#volume = checkedVolume(options.volume ?? 0.5)
    this.#stopped = false
    this.#setState('connecting')
    this.#openSession()
  }

  stop(): void {
    this.#stopped = true
    this.#generation += 1
    this.#clearTimers()
    this.#closeSession()
    this.#backoffIndex = 0
    this.#hasPlayed = false
    this.#setState('idle')
    this.#options = undefined
  }

  close(): void {
    this.stop()
  }

  setVolume(volume: number): void {
    this.#volume = checkedVolume(volume)
    this.#session?.audio.enqueue(0, AudioOut.Volume, Math.round(this.#volume * 256))
  }

  #validateOptions(options: WebRadioStartOptions): void {
    const url = new URL(options.url)
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      throw new Error('WebRadio supports only HTTP and HTTPS URLs')
    if ((options.sampleRate ?? 44100) !== 44100) throw new Error('WebRadio MVP supports only 44100 Hz streams')
    if (options.volume !== undefined) checkedVolume(options.volume)
  }

  #openSession(): void {
    const options = this.#options
    if (this.#stopped || !options) return
    const url = new URL(options.url)
    const generation = ++this.#generation
    const audio = new AudioOut({ streams: 1, bitsPerSample: 16, numChannels: 1, sampleRate: 44100 })
    audio.enqueue(0, AudioOut.Volume, Math.round(this.#volume * 256))
    const session: Session = { audio, generation }
    this.#session = session
    this.#setState(this.#backoffIndex > 0 ? 'retrying' : 'buffering')
    const path = `${url.pathname}${url.search}` || '/'
    session.streamer = new MP3Streamer({
      http: url.protocol === 'https:' ? device.network.https : device.network.http,
      host: url.hostname,
      port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
      path,
      audio: { out: audio, stream: 0, sampleRate: 44100 },
      onReady: (ready) => this.#onReady(generation, ready),
      onError: (reason) => this.#fail(generation, String(reason)),
      onDone: () => this.#fail(generation, 'stream ended'),
    })
  }

  #onReady(generation: number, ready: boolean): void {
    if (!this.#isCurrent(generation)) return
    this.#clearStallTimer()
    if (ready) {
      this.#session?.audio.start()
      this.#hasPlayed = true
      this.#backoffIndex = 0
      this.#setState('playing')
      return
    }
    this.#session?.audio.stop()
    this.#setState(this.#hasPlayed ? 'stalled' : 'buffering')
    this.#stallTimer = Timer.set(() => this.#fail(generation, 'stream stalled'), STALL_TIMEOUT_MS)
  }

  #fail(generation: number, reason: string): void {
    if (!this.#isCurrent(generation)) return
    this.#clearStallTimer()
    this.#closeSession()
    if (this.#stopped || !this.#options?.reconnect) {
      this.#setState('error', reason)
      return
    }
    const delay = BACKOFF_SECONDS[Math.min(this.#backoffIndex, BACKOFF_SECONDS.length - 1)] * 1000
    this.#backoffIndex += 1
    this.#setState('retrying', reason)
    this.#reconnectTimer = Timer.set(() => {
      this.#reconnectTimer = undefined
      this.#openSession()
    }, delay)
  }

  #isCurrent(generation: number): boolean {
    return !this.#stopped && this.#session?.generation === generation
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
      session.audio.enqueue(0, AudioOut.Flush)
      session.audio.stop()
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
    this.#clearStallTimer()
    if (this.#reconnectTimer !== undefined) Timer.clear(this.#reconnectTimer)
    this.#reconnectTimer = undefined
  }

  #setState(state: WebRadioState, reason?: string): void {
    if (this.#state === state && reason === undefined) return
    this.#state = state
    this.#options?.onStateChanged?.(state, reason)
  }
}
