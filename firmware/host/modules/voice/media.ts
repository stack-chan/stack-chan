import type { AudioSink, AudioSource, MediaBudget, MediaRuntime, PcmFormat } from 'stackchan/voice/contracts'
import { deferred, requireActive, voiceError } from 'stackchan/voice/scope'

export type PcmConsumer = {
  write(bytes: Uint8Array): void | Promise<void>
  end(error?: unknown): void
}
type Reader = PcmConsumer & {
  busy?: boolean
}
type PcmReader = AudioSource & { attach(reader: Reader, replayMs?: number): { close(): void } }
type PcmWriter = AudioSink & { write(bytes: Uint8Array): void | Promise<void> }
export type PcmProducer = {
  readonly output: AudioSource
  offer(bytes: Uint8Array): void | Promise<void>
  push(bytes: Uint8Array): Promise<void>
  clearHistory(): void
  end(error?: unknown): void
}

export const mono = (sampleRate: number): PcmFormat => ({ encoding: 'pcm_s16le', sampleRate, channels: 1 })
export function capacity(budget: MediaBudget, format: PcmFormat) {
  const frame = format.channels * 2
  if (
    !Number.isSafeInteger(budget.maxBufferedBytes) ||
    !Number.isFinite(budget.maxBufferedMs) ||
    budget.maxBufferedMs <= 0 ||
    budget.maxBufferedBytes < frame
  )
    throw new RangeError('invalid PCM budget')
  const bytes = Math.min(budget.maxBufferedBytes, (format.sampleRate * frame * budget.maxBufferedMs) / 1000)
  return Math.floor(bytes / frame) * frame
}

export function createPcmSource(format: PcmFormat, historyBytes = 0): PcmProducer {
  if (!Number.isSafeInteger(historyBytes) || historyBytes < 0 || historyBytes % (format.channels * 2))
    throw new RangeError('invalid PCM history size')
  const readers = new Set<Reader>()
  let inFlight = 0
  const ring = new Uint8Array(historyBytes)
  let offset = 0,
    retained = 0,
    ended = false
  function endReader(reader: Reader, error?: unknown) {
    try {
      reader.end(error)
    } catch {
      // 購読者の終了処理に失敗しても、他の購読者へ終了を通知する
    }
  }
  function notifyEnd(error?: unknown) {
    for (const reader of readers) {
      readers.delete(reader)
      endReader(reader, error)
    }
  }
  function track(promise: Promise<void>) {
    inFlight++
    const settled = () => {
      inFlight--
      if (ended && inFlight === 0) notifyEnd()
    }
    void promise.then(settled, settled)
    return promise
  }
  const output = {
    format,
    attach(reader: Reader, replayMs = 0) {
      if (ended || readers.size >= 4) throw voiceError('resource_exhausted', 'PCM source unavailable')
      const requested = Math.floor((replayMs * format.sampleRate) / 1000) * format.channels * 2
      if (requested > ring.length) throw voiceError('resource_exhausted', 'pre-roll exceeds capture budget')
      const size = Math.min(requested, retained)
      if (size > 0) {
        const start = (offset - size + ring.length) % ring.length
        const first = Math.min(size, ring.length - start)
        const replay = new Uint8Array(size)
        replay.set(ring.subarray(start, start + first))
        if (first < size) replay.set(ring.subarray(0, size - first), first)
        const pending = reader.write(replay)
        if (pending) {
          reader.busy = true
          track(
            pending.then(
              () => {
                reader.busy = false
              },
              (error) => {
                readers.delete(reader)
                endReader(reader, error)
              },
            ),
          )
        }
      }
      readers.add(reader)
      return {
        close: () => {
          readers.delete(reader)
        },
      }
    },
  } as PcmReader
  function offer(bytes: Uint8Array): void | Promise<void> {
    if (ended) throw voiceError('cancelled')
    if (bytes.length % (format.channels * 2)) throw new RangeError('partial PCM frame')
    if (ring.length) {
      const tail = bytes.length > ring.length ? bytes.subarray(bytes.length - ring.length) : bytes
      const first = Math.min(tail.length, ring.length - offset)
      ring.set(tail.subarray(0, first), offset)
      ring.set(tail.subarray(first), 0)
      offset = (offset + tail.length) % ring.length
      retained = Math.min(ring.length, retained + tail.length)
    }
    let pending: Promise<void> | undefined
    let problem: unknown
    let failed = false
    function fail(error: unknown) {
      if (!failed) problem = error
      failed = true
    }
    for (const reader of readers) {
      try {
        if (reader.busy) throw voiceError('input_overrun', 'PCM consumer has not released its previous frame')
        const result = reader.write(bytes)
        if (result) {
          reader.busy = true
          const completion = track(
            result.then(
              () => {
                reader.busy = false
              },
              (error) => {
                readers.delete(reader)
                endReader(reader, error)
                fail(error)
              },
            ),
          )
          pending = pending ? Promise.all([pending, completion]).then(() => {}) : completion
        }
      } catch (error) {
        readers.delete(reader)
        endReader(reader, error)
        fail(error)
      }
    }
    if (pending)
      return pending.then(() => {
        if (failed) throw problem
      })
    if (failed) throw problem
  }
  return {
    output,
    offer,
    async push(bytes: Uint8Array) {
      await offer(bytes)
    },
    clearHistory() {
      retained = 0
      offset = 0
    },
    end(error?: unknown) {
      if (ended) {
        if (error) notifyEnd(error)
        return
      }
      ended = true
      if (error || inFlight === 0) notifyEnd(error)
    },
  }
}
export function subscribePcmSource(source: AudioSource, consumer: PcmConsumer) {
  return (source as PcmReader).attach({ write: (bytes) => consumer.write(bytes), end: (error) => consumer.end(error) })
}
export function readSource(source: AudioSource, write: Reader['write'], onError?: (error: unknown) => void) {
  return (source as PcmReader).attach({
    write,
    end(error) {
      if (error) onError?.(error)
    },
  })
}
export function createPcmSink(format: PcmFormat, write: Reader['write']): AudioSink {
  return { format, write } as PcmWriter
}
export async function writeSink(sink: AudioSink, bytes: Uint8Array) {
  await (sink as PcmWriter).write(bytes)
}
export const pcmMedia: MediaRuntime = {
  async connect(source, sink, options) {
    requireActive(options.signal)
    if (source.format.sampleRate !== sink.format.sampleRate || source.format.channels !== sink.format.channels)
      throw voiceError('unsupported_capability', 'incompatible PCM formats')
    const limit = capacity(options.budget, source.format)
    const result = deferred<void>()
    // The caller may be generating audio while the consumer fails asynchronously.
    void result.promise.catch(() => {})
    let closed = false
    let subscription: { close(): void } | undefined
    function finish(error?: unknown) {
      if (closed) return
      closed = true
      options.signal.removeEventListener('abort', abort)
      subscription?.close()
      if (error) result.reject(error)
      else result.resolve()
    }
    const abort = () => finish(voiceError('cancelled'))
    subscription = (source as PcmReader).attach(
      {
        write(bytes) {
          if (closed) throw voiceError('cancelled')
          if (bytes.length > limit) throw voiceError('resource_exhausted', 'PCM frame exceeds link budget')
          return (sink as PcmWriter).write(bytes)
        },
        end: finish,
      },
      options.replayMs,
    )
    options.signal.addEventListener('abort', abort)
    return {
      done: result.promise,
      async close() {
        finish()
      },
    }
  },
}
