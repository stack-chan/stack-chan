import type HTTPClient from 'embedded:network/http/client'
import type { ClientOptions, RequestOptions } from 'embedded:network/http/client'
import { asStackchanError, StackchanError } from 'stackchan/errors'
import type { PlaybackSession } from 'tts-playback-session'

type ResolverRequest = {
  host: string
  onResolved(host: string, address: string): void
  onError(error: unknown): void
}
type Resolver = { resolve(options: ResolverRequest): void; close(): void }
type Connection = Pick<HTTPClient, 'close' | 'request'>
export type PlaybackHttpOptions = {
  io: new (options: ClientOptions) => Connection
  dns: { io: new (options: object) => Resolver; [key: string]: unknown }
  socket?: unknown
}
type Owner = Pick<PlaybackSession, 'closed' | 'addCleanup'>
export const MAX_TTS_JSON_BYTES = 32 * 1024

export function ttsJSONRequest(
  owner: Pick<PlaybackSession, 'closed' | 'fail'>,
  value: unknown,
  headers: Array<[string, string]> = [],
): RequestOptions {
  const body = ArrayBuffer.fromString(JSON.stringify(value))
  if (body.byteLength > MAX_TTS_JSON_BYTES)
    throw new StackchanError('INVALID_ARGUMENT', 'Speech request is too large; shorten the text')
  let offset = 0
  return {
    method: 'POST',
    headers: new Map([...headers, ['content-type', 'application/json'], ['content-length', String(body.byteLength)]]),
    onWritable(count) {
      if (owner.closed) return
      try {
        const end = Math.min(offset + count, body.byteLength)
        if (end > offset) this.write(body.slice(offset, end))
        offset = end
      } catch (error) {
        owner.fail(error)
      }
    },
  }
}

/** Own the SDK client's resolver too, including a failed streamer constructor. */
export function playbackHttp(owner: Owner, defaults: PlaybackHttpOptions): PlaybackHttpOptions {
  return {
    ...defaults,
    io: class {
      #client: Connection | undefined
      #resolver: Resolver | undefined
      #closed = false
      #failure: unknown

      constructor(options: ClientOptions) {
        if (owner.closed) throw new StackchanError('CLOSED', 'Playback is closed')
        owner.addCleanup(() => this.close())
        const connection = this
        const dns = defaults.dns
        this.#client = new defaults.io({
          ...options,
          dns: {
            ...dns,
            io: class {
              constructor(options: object) {
                connection.#resolver = new dns.io(options)
              }
              resolve(request: ResolverRequest) {
                connection.#resolver?.resolve({
                  ...request,
                  onResolved(host, address) {
                    if (!connection.#closed && !owner.closed) request.onResolved(host, address)
                  },
                  onError(error) {
                    if (!connection.#closed && !owner.closed) request.onError(error)
                  },
                })
              }
            },
          },
        })
      }

      request(options: RequestOptions) {
        if (this.#closed || owner.closed || !this.#client)
          throw new StackchanError('CLOSED', 'Playback connection is closed')
        return this.#client.request(options)
      }

      close() {
        if (!this.#closed) {
          this.#closed = true
          // Attempt both closes even when either throws. Retain the failure if
          // an SDK callback observes it before the owner's release boundary.
          try {
            this.#client?.close()
          } catch (error) {
            this.#failure = asStackchanError(error)
          }
          try {
            this.#resolver?.close()
          } catch (error) {
            this.#failure ??= asStackchanError(error)
          }
          this.#client = undefined
          this.#resolver = undefined
        }
        if (this.#failure !== undefined) throw this.#failure
      }
    },
  }
}
