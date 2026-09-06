import Headers from 'headers'
import { asStackchanError, StackchanError } from 'stackchan/errors'
import Timer from 'timer'
import { MAX_TTS_JSON_BYTES, type PlaybackHttpOptions, playbackHttp } from 'tts-http-client'
import { createPlaybackSession, PlaybackProvider, type PlaybackSession } from 'tts-playback-session'

export const TTS_QUERY_TIMEOUT_MS = 30_000

type Owner = Pick<PlaybackSession, 'closed' | 'addCleanup' | 'waitFor'>
type QueryOptions = {
  http: PlaybackHttpOptions
  host: string
  port: number
  path: string
  method?: 'GET' | 'POST'
  timeoutMs?: number
}

/** Bounded preparation, cancelled and released within its playback operation. */
export function requestTTSQuery(owner: Owner, options: QueryOptions): Promise<unknown> {
  const queryOwner = new PlaybackProvider()
  let body: Uint8Array | undefined
  let used = 0
  let resolve!: (value: unknown) => void
  let reject!: (error: unknown) => void
  let value: unknown
  const result = new Promise<unknown>((yes, no) => {
    resolve = yes
    reject = no
  })
  const session = createPlaybackSession(queryOwner, (error) => {
    body = undefined
    if (error !== undefined) reject(error)
    else resolve(value)
  })
  owner.waitFor(result)
  owner.addCleanup(() => session.cancel())
  try {
    if (owner.closed) throw new StackchanError('CLOSED', 'Playback is closed')
    const timer = Timer.set(
      () => session.fail(new StackchanError('TIMEOUT', 'Speech preparation timed out')),
      options.timeoutMs ?? TTS_QUERY_TIMEOUT_MS,
    )
    session.addCleanup(() => Timer.clear(timer))
    body = new Uint8Array(MAX_TTS_JSON_BYTES)
    const http = playbackHttp(session, options.http)
    const client = new http.io({
      ...http,
      host: options.host,
      port: options.port,
      onError: (error) => session.fail(asStackchanError(error)),
    })
    client.request({
      method: options.method ?? 'GET',
      path: options.path,
      headers: new Headers([['content-type', 'application/x-www-form-urlencoded']]),
      onHeaders(status, headers) {
        if (session.closed) return
        if (status !== 200) session.fail(new StackchanError('IO', `Speech preparation returned HTTP ${status}`))
        else if (Number(headers.get('content-length')) > MAX_TTS_JSON_BYTES)
          session.fail(new StackchanError('IO', 'Speech preparation response is too large; shorten the text'))
      },
      onReadable(count) {
        if (session.closed || !body) return
        try {
          if (!Number.isInteger(count) || count <= 0 || count > MAX_TTS_JSON_BYTES - used)
            throw new StackchanError('IO', 'Speech preparation response is too large; shorten the text')
          const chunk = this.read(count)
          if (!chunk || chunk.byteLength === 0 || chunk.byteLength > count)
            throw new StackchanError('IO', 'Speech preparation returned an invalid chunk')
          body.set(new Uint8Array(chunk), used)
          used += chunk.byteLength
        } catch (error) {
          session.fail(asStackchanError(error))
        }
      },
      onDone(error) {
        if (session.closed || !body) return
        try {
          if (error) throw error
          value = JSON.parse(String.fromArrayBuffer((body.buffer as ArrayBuffer).slice(0, used)))
          session.onDone()
        } catch (error) {
          session.fail(asStackchanError(error))
        }
      },
    })
  } catch (error) {
    session.fail(asStackchanError(error))
  }
  return result
}
