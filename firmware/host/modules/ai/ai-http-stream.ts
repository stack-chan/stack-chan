import { checkScope, failure } from 'stackchan-ai-core'
import type { SendResponseRequest } from 'stackchan-ai-responses'

export type ResponseWriter = {
  read(count: number): ArrayBuffer | undefined
  read(buffer: Uint8Array): number | undefined
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
  diagnostic?: { now(): number; emit(values: number[]): void }
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
  idleTimeout = false,
  readAhead = false,
): SendResponseRequest {
  return (body, consume, scope, isComplete) =>
    new Promise((resolve, reject) => {
      checkScope(scope)
      let client: ResponseConnection | undefined
      const abort = () => finish(failure('cancelled', 'Responses request cancelled'))
      let timeout = platform.schedule(
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
      const ring = readAhead ? new Uint8Array(maxPendingBytes) : undefined
      let head = 0,
        activeBytes = 0
      const maxRead = Math.min(maxPendingBytes, 4096)
      let buffered = 0,
        peakBuffered = 0,
        peakParts = 0,
        unreadAtEnd = 0
      let awaitingReadable: number | undefined, previousReadable: number | undefined
      let waitTotal = 0,
        waitMax = 0,
        callbackGap = 0
      let bodyReceived = false
      let connectionError: unknown
      let bytes: Uint8Array = new Uint8Array(0)
      let offset = 0
      const chunks = body.read()[Symbol.iterator]()
      const diagnostic = platform.diagnostic
      const now = () => diagnostic?.now() ?? 0
      const started = now()
      let received = 0,
        peak = 0,
        consumeTotal = 0,
        consumeMax = 0,
        consuming: number | undefined
      function report(event: number, error?: unknown) {
        if (!diagnostic) return
        const message = error instanceof Error ? error.message : ''
        const category =
          error == null
            ? 0
            : /authentication|bad record mac/i.test(message)
              ? 2
              : /alert/i.test(message)
                ? 3
                : error instanceof Error
                  ? 1
                  : 4
        try {
          diagnostic.emit([
            event,
            category,
            status,
            received,
            available,
            peak,
            (now() - started) >>> 0,
            consumeTotal,
            consumeMax,
            consuming === undefined ? 0 : (now() - consuming) >>> 0,
          ])
        } catch {}
      }
      function finish(error?: unknown) {
        if (finished) return
        report(3, error)
        if (readAhead && diagnostic) {
          try {
            diagnostic.emit([
              4,
              status,
              received,
              (now() - started) >>> 0,
              waitTotal,
              waitMax,
              callbackGap,
              peakBuffered,
              peakParts,
              unreadAtEnd,
            ])
          } catch {}
        }
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
        if (!ended) unreadAtEnd = available
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
      function take(count: number) {
        const data = reader?.read(count)
        if (!data || typeof data === 'number' || data.byteLength !== count) throw Error('short HTTP read')
        received += count
        available -= count
        return data
      }
      function prefetch() {
        if (!ring) return
        // SDK Request.read(view) fills owned storage directly. The active consumer's
        // view stays in the ring until its promise settles, so no region is overwritten.
        while (!finished && !ended && available > 0 && buffered < ring.length) {
          const tail = (head + buffered) % ring.length
          const count = Math.min(available, ring.length - buffered, ring.length - tail)
          const actual = reader?.read(ring.subarray(tail, tail + count))
          if (actual !== count) throw Error('short HTTP read')
          received += count
          available -= count
          buffered += count
          // Occupancy includes the borrowed consumer view, unlike the former queue.
          peakBuffered = Math.max(peakBuffered, buffered)
          // At most two occupied spans, regardless of callback fragmentation.
          peakParts = Math.max(peakParts, head + buffered > ring.length ? 2 : 1)
        }
      }
      async function pump() {
        reading = true
        try {
          while ((available > 0 || buffered > 0) && !finished) {
            let data: Uint8Array
            if (ring) {
              prefetch()
              activeBytes = Math.min(buffered, maxRead, ring.length - head)
              data = ring.subarray(head, head + activeBytes)
            } else data = new Uint8Array(take(Math.min(available, maxRead)))
            // 最初のreadはcallback内で受け取り、SSE解析はTLSのnativeスタックを抜けてから行う
            await Promise.resolve()
            if (finished) return
            if (idleTimeout) platform.clear(timeout)
            consuming = now()
            try {
              await consume(data)
            } finally {
              const duration = (now() - consuming) >>> 0
              consumeTotal += duration
              consumeMax = Math.max(consumeMax, duration)
              consuming = undefined
              if (ring) {
                head = (head + activeBytes) % ring.length
                buffered -= activeBytes
                activeBytes = 0
              }
            }
            if (idleTimeout && !finished)
              timeout = platform.schedule(
                () => finish(failure('deadline_exceeded', 'Responses request timed out')),
                timeoutMs,
              )
            if (isComplete?.()) finish()
          }
        } catch (error) {
          finish(error)
        } finally {
          reading = false
          if (readAhead && diagnostic && !ended && !finished) awaitingReadable = now()
        }
      }
      try {
        scope.signal.addEventListener('abort', abort)
        client = platform.connect((error) => {
          report(1, error)
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
            if (readAhead && diagnostic) {
              const tick = now()
              if (previousReadable !== undefined) callbackGap = Math.max(callbackGap, (tick - previousReadable) >>> 0)
              previousReadable = tick
              if (awaitingReadable !== undefined) {
                const wait = (tick - awaitingReadable) >>> 0
                waitMax = Math.max(waitMax, wait)
                waitTotal += wait
                awaitingReadable = undefined
              }
            }
            reader = this
            // countは未読バイト数のsnapshot。consumerが止まっている間はTLS側に残す
            peak = Math.max(peak, count)
            available = count
            if (!reading) drain = pump()
            else if (readAhead) {
              try {
                prefetch()
              } catch (error) {
                finish(error)
              }
            }
          },
          onDone(error) {
            report(2, error)
            end(error || !status ? failure('provider_failed', 'Responses connection closed early') : undefined)
          },
        })
      } catch (error) {
        finish(error)
      }
    })
}
