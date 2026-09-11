import type HTTPClient from 'embedded:network/http/client'
import type { RequestOptions } from 'embedded:network/http/client'
import type AudioOut from 'pins/audioout'
import type { PlaybackHttpOptions } from 'tts-http-client'

type Options = {
  http: PlaybackHttpOptions
  host: string
  port: number
  path: string
  audio: { out: AudioOut; stream: number }
  bufferDuration?: number
  request?: RequestOptions
  onPlayed?(buffer: ArrayBuffer): void
  onReady?(ready: boolean): void
  onError?(error: unknown): void
  onDone?(): void
}
export default class Streamer {
  static instances: Streamer[] = []
  static onCreated?: (streamer: Streamer) => void
  static constructorFailure = false
  closes = 0
  readonly #client: Pick<HTTPClient, 'request' | 'close'>
  constructor(readonly options: Options) {
    this.#client = new options.http.io({ ...options.http, host: options.host, port: options.port })
    this.#client.request({ ...options.request, path: options.path })
    Streamer.instances.push(this)
    if (Streamer.constructorFailure) throw new Error('streamer constructor failed')
    Streamer.onCreated?.(this)
  }
  done() {
    this.options.onDone?.()
  }
  close() {
    this.closes++
    this.#client.close()
  }
}
