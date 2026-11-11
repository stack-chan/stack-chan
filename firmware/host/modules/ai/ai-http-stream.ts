import { checkScope, failure } from 'stackchan-ai-core'
import type { SendResponseRequest } from 'stackchan-ai-responses'

export type ResponseWriter = {
  read(count: number): ArrayBuffer | undefined
  write(data: Uint8Array): number
}
export type ResponseConnection = {
  close(): void
  request(options: {
    method: string
    path: string
    headers: Map<string, string>
    onHeaders(code: number): void
    onReadable(this: ResponseWriter, count: number): void
    onWritable(this: ResponseWriter, count: number): void
    onDone(error?: unknown): void
  }): unknown
}
export interface ResponsePlatform<T> {
  path: string
  extraHeaders?: Readonly<Record<string, string>>
  connect(onError: (error?: unknown) => void): ResponseConnection
  schedule(task: () => void, ms: number): T
  clear(timer: T): void
}
export function streamResponse<T>(
  platform: ResponsePlatform<T>,
  apiKey: string,
  timeoutMs: number,
  maxPendingBytes: number,
): SendResponseRequest {
  return (body, consume, scope, isComplete) =>
    new Promise((resolve, reject) => {
      checkScope(scope)
      let client: ResponseConnection | undefined
      const abort = () => finish(failure('cancelled', 'Responses request cancelled'))
      const timeout = platform.schedule(
        () => finish(failure('deadline_exceeded', 'Responses request timed out')),
        timeoutMs,
      )
      let finished = false,
        pending = 0,
        queued = 0,
        status = 0
      let drain = Promise.resolve()
      let bodyReceived = false
      let connectionError: unknown
      let bytes: Uint8Array = new Uint8Array(0)
      let offset = 0
      const chunks = body.read()[Symbol.iterator]()
      function finish(error?: unknown) {
        if (finished) return
        finished = true
        platform.clear(timeout)
        scope.signal.removeEventListener('abort', abort)
        // ECMA-419のcallbackを抜けてからTLS socketを閉じる
        platform.schedule(() => {
          try {
            client?.close()
          } catch (closeError) {
            error ??= closeError
          }
          if (error) reject(error)
          else resolve()
        }, 0)
      }
      function end(error?: unknown) {
        if (finished) return
        if (error) connectionError = error
        else bodyReceived = true
        // SDKがソケットの切断を知らせた時点では、最後のSSEイベントが解析待ちの場合がある。
        void drain.then(() => {
          if (bodyReceived || isComplete?.()) finish()
          else finish(connectionError)
        })
      }
      try {
        scope.signal.addEventListener('abort', abort)
        client = platform.connect((error) => {
          const reason = error instanceof Error ? error.message : undefined
          end(
            failure(
              'provider_failed',
              reason ? `Responses connection failed: ${reason}` : 'Responses connection failed',
            ),
          )
        })
        const headers = new Map<string, string>([
          ['content-type', 'application/json'],
          ['accept', 'text/event-stream'],
          ['content-length', String(body.length)],
          ['connection', 'close'],
        ])
        for (const [name, value] of Object.entries(platform.extraHeaders ?? {})) headers.set(name, value)
        if (apiKey) headers.set('authorization', 'Bearer ' + apiKey)
        client.request({
          method: 'POST',
          path: platform.path,
          headers,
          onHeaders(code) {
            status = code
            if (code < 200 || code > 299) finish(failure('provider_failed', 'Responses HTTP ' + code))
          },
          onWritable(count) {
            if (finished || !count) return
            try {
              while (count > 0) {
                if (offset >= bytes.length) {
                  const part = chunks.next()
                  if (part.done) return
                  bytes = part.value
                  offset = 0
                }
                const n = Math.min(count, bytes.length - offset)
                if (!n) continue
                count = this.write(bytes.subarray(offset, offset + n))
                offset += n
              }
            } catch (error) {
              finish(error)
            }
          },
          onReadable(count) {
            if (finished || !count) return
            try {
              if (pending + count > maxPendingBytes || queued >= 16)
                throw failure('resource_exhausted', 'Responses consumer is too slow')
              const data = this.read(count)
              if (!data || data.byteLength !== count) throw Error('short HTTP read')
              queued++
              pending += count
              drain = drain
                .then(async () => {
                  if (!finished) {
                    await consume(new Uint8Array(data))
                    if (isComplete?.()) finish()
                  }
                  queued--
                  pending -= count
                })
                .catch(finish)
            } catch (error) {
              finish(error)
            }
          },
          onDone(error) {
            end(error || !status ? failure('provider_failed', 'Responses connection closed early') : undefined)
          },
        })
      } catch (error) {
        finish(error)
      }
    })
}
