import Headers from 'headers'
import { asStackchanError, finiteNumber, StackchanError } from 'stackchan/errors'
import type { HttpRequest, HttpResponse } from 'stackchan/extensions/network'
import type { CancellationSignal } from 'stackchan/task'
import Timer from 'timer'
import { URL } from 'url'

type HttpBody = { write(view?: DataView): void; read(count: number): ArrayBuffer }
type Client = {
  close(): void
  request(options: {
    method: string
    path: string
    headers: Headers
    onHeaders(status: number): void
    onWritable(this: HttpBody, count: number): void
    onReadable(this: HttpBody, count: number): void
    onDone(error?: unknown): void
  }): void
}
type Environment = { io: new (options: object) => Client }
type Device = { network?: { http?: { client?: Environment }; https?: { client?: Environment } } }

/** Shared bounded HTTP transport for app requests, dialogue and multipart transcription. */
export default function requestHttp(
  request: Omit<HttpRequest, 'body'> & { body?: string | readonly ArrayBuffer[]; onChunk?(chunk: ArrayBuffer): void },
  signal?: CancellationSignal,
): Promise<HttpResponse> {
  signal?.throwIfCancelled()
  const endpoint = new URL(request.url)
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:')
    throw new StackchanError('INVALID_ARGUMENT', 'HTTP or HTTPS URL required')
  const timeoutMs = request.timeoutMs ?? 30_000
  const limit = request.maxResponseBytes ?? 65_536
  finiteNumber(timeoutMs, 'timeoutMs', 1, 120_000)
  finiteNumber(limit, 'maxResponseBytes', 1, 1_048_576)
  const environment = (globalThis as { device?: Device }).device?.network?.[
    endpoint.protocol === 'https:' ? 'https' : 'http'
  ]?.client
  if (!environment?.io) throw new StackchanError('UNSUPPORTED', 'HTTP client is unavailable')
  const parts = typeof request.body === 'string' ? [ArrayBuffer.fromString(request.body)] : (request.body ?? [])
  const headers = new Headers(Object.entries(request.headers ?? {}))
  if (parts.length) headers.set('content-length', String(parts.reduce((length, part) => length + part.byteLength, 0)))
  return new Promise((resolve, reject) => {
    let client: Client | undefined, timer: ReturnType<typeof Timer.set> | undefined, remove: (() => void) | undefined
    let finished = false,
      bodyWritten = false,
      status = 0,
      length = 0,
      index = 0,
      offset = 0
    const chunks: ArrayBuffer[] = []
    const finish = (error?: unknown) => {
      if (finished) return
      finished = true
      if (timer !== undefined) Timer.clear(timer)
      remove?.()
      try {
        client?.close()
      } catch (closeError) {
        error ??= closeError
      }
      if (error !== undefined) reject(asStackchanError(error))
      else {
        const bytes = new Uint8Array(length)
        let at = 0
        for (const chunk of chunks) {
          bytes.set(new Uint8Array(chunk), at)
          at += chunk.byteLength
        }
        resolve({ status, body: String.fromArrayBuffer(bytes.buffer) })
      }
    }
    try {
      remove = signal?.subscribe(finish)
      if (finished) {
        remove?.()
        return
      }
      timer = Timer.set(() => finish(new StackchanError('TIMEOUT', 'HTTP request timed out')), timeoutMs)
      client = new environment.io({
        ...environment,
        host: endpoint.hostname,
        port: Number(endpoint.port) || (endpoint.protocol === 'https:' ? 443 : 80),
        onError: (error: unknown) => finish(error ?? new StackchanError('IO', 'HTTP connection failed')),
      })
      client.request({
        method: request.method ?? 'GET',
        path: endpoint.pathname + endpoint.search,
        headers,
        onHeaders(value: number) {
          status = value
          if (request.onChunk && (value < 200 || value >= 300))
            finish(new StackchanError('IO', `HTTP stream failed (${value})`))
        },
        onWritable(count: number) {
          if (finished || bodyWritten) return
          while (count > 0 && index < parts.length) {
            const part = parts[index],
              size = Math.min(count, part.byteLength - offset)
            if (size > 0) this.write(new DataView(part, offset, size))
            count -= size
            offset += size
            if (offset === part.byteLength) {
              index++
              offset = 0
            }
          }
          if (index === parts.length) {
            bodyWritten = true
            this.write()
          }
        },
        onReadable(count: number) {
          if (finished) return
          if (count > limit - length) {
            finish(new StackchanError('IO', 'HTTP response exceeds its byte limit'))
            return
          }
          const chunk = this.read(count)
          if (chunk) {
            if (request.onChunk) {
              try {
                request.onChunk(chunk)
                if (timer !== undefined) Timer.schedule(timer, timeoutMs)
              } catch (error) {
                finish(error)
              }
            } else {
              chunks.push(chunk)
              length += chunk.byteLength
            }
          }
        },
        onDone(error: unknown) {
          finish(error)
        },
      })
    } catch (error) {
      finish(error)
    }
  })
}
