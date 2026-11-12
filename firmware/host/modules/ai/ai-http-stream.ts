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
        available = 0,
        reading = false,
        ended = false,
        status = 0
      let reader: ResponseWriter | undefined
      let drain = Promise.resolve()
      let bodyReceived = false
      let connectionError: unknown
      let bytes: Uint8Array = new Uint8Array(0)
      let offset = 0
      const chunks = body.read()[Symbol.iterator]()
      function finish(error?: unknown) {
        if (finished) return
        finished = true
        reader = undefined
        available = 0
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
        // SDKはonDone後にrequestを無効にする。解析待ちのデータだけを完了まで待つ
        ended = true
        reader = undefined
        available = 0
        if (error) connectionError = error
        else bodyReceived = true
        // SDKがソケットの切断を知らせた時点では、最後のSSEイベントが解析待ちの場合がある。
        void drain.then(() => {
          if (bodyReceived || isComplete?.()) finish()
          else finish(connectionError)
        })
      }
      async function pump() {
        reading = true
        try {
          while (available > 0 && !finished) {
            const count = Math.min(available, maxPendingBytes, 4096)
            const data = reader?.read(count)
            if (!data || data.byteLength !== count) throw Error('short HTTP read')
            available -= count
            // 最初のreadはcallback内で受け取り、SSE解析はTLSのnativeスタックを抜けてから行う
            await Promise.resolve()
            if (finished) return
            await consume(new Uint8Array(data))
            if (isComplete?.()) finish()
          }
        } catch (error) {
          finish(error)
        } finally {
          reading = false
        }
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
            if (finished || ended || !count) return
            reader = this
            // countは未読バイト数のsnapshot。consumerが止まっている間はTLS側に残す
            available = count
            if (!reading) drain = pump()
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
