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
        status = 0
      let reader: ResponseWriter | undefined
      let ended: { error?: unknown } | undefined
      let pending: { bytes: Uint8Array; length: number } | undefined
      let consumingBytes = 0
      let bytes: Uint8Array = new Uint8Array(0)
      let offset = 0
      const chunks = body.read()[Symbol.iterator]()
      function finish(error?: unknown) {
        if (finished) return
        finished = true
        reader = undefined
        available = 0
        pending = undefined
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
        if (finished || ended) return
        // Moddable SDKはonDoneの呼び出し時点でrequest.read()を無効にする
        ended = {
          error: error ?? (available ? failure('provider_failed', 'incomplete HTTP response body') : undefined),
        }
        reader = undefined
        available = 0
        if (!reading) void pump()
      }
      function connectionFailure(error: unknown) {
        const reason = error instanceof Error ? error.message : undefined
        return failure(
          'provider_failed',
          reason ? `Responses connection failed: ${reason}` : 'Responses connection closed early',
        )
      }
      function read(count: number) {
        const data = reader?.read(count)
        if (!data || data.byteLength !== count) throw Error('short HTTP read')
        available -= count
        return new Uint8Array(data)
      }
      function prefetch() {
        const capacity = maxPendingBytes - consumingBytes
        const length = pending?.length ?? 0
        const count = Math.min(available, capacity - length)
        if (count <= 0) return
        const chunk = read(count)
        if (!pending) {
          pending = { bytes: chunk, length: count }
          return
        }
        if (pending.bytes.length < length + count) {
          const next = new Uint8Array(Math.min(capacity, Math.max(length + count, pending.bytes.length * 2)))
          next.set(pending.bytes.subarray(0, length))
          pending.bytes = next
        }
        pending.bytes.set(chunk, length)
        pending.length += count
      }
      async function pump() {
        reading = true
        try {
          while (!finished && (pending || available > 0)) {
            const chunk = pending
              ? pending.bytes.subarray(0, pending.length)
              : read(Math.min(available, maxPendingBytes))
            pending = undefined
            consumingBytes = chunk.byteLength
            // TLSのコールバックを抜けてからSSEを解析する
            await Promise.resolve()
            if (finished) return
            await consume(chunk)
            consumingBytes = 0
            if (isComplete?.()) return finish()
          }
          if (ended) finish(ended.error)
        } catch (error) {
          finish(error)
        } finally {
          reading = false
        }
      }
      try {
        scope.signal.addEventListener('abort', abort)
        client = platform.connect((error) => end(connectionFailure(error)))
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
            // countは未読バイト数のスナップショット。前回通知の残量も含む
            available = count
            if (!reading) {
              void pump()
              return
            }
            try {
              prefetch()
            } catch (error) {
              finish(error)
            }
          },
          onDone(error) {
            end(error || !status ? connectionFailure(error) : undefined)
          },
        })
      } catch (error) {
        finish(error)
      }
    })
}
