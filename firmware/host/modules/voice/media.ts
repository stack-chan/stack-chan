import type { AudioSink, AudioSource, MediaBudget, MediaRuntime, PcmFormat } from 'stackchan/voice/contracts'
import { deferred, requireActive, voiceError } from 'stackchan/voice/scope'

type Reader = {
  write(bytes: Uint8Array): void | Promise<void>
  end(error?: unknown): void
  busy?: boolean
}
type PcmReader = AudioSource & { attach(reader: Reader, replayMs?: number): { close(): void } }
type PcmWriter = AudioSink & { write(bytes: Uint8Array): void | Promise<void> }

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

export function createPcmSource(format: PcmFormat, historyBytes = 0) {
  const readers = new Set<Reader>()
  const ring = new Uint8Array(historyBytes)
  let offset = 0,
    retained = 0,
    ended = false
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
          void pending.then(
            () => {
              reader.busy = false
            },
            (error) => {
              readers.delete(reader)
              reader.end(error)
            },
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
    for (const reader of readers) {
      try {
        if (reader.busy) throw voiceError('input_overrun', 'PCM consumer has not released its previous frame')
        const result = reader.write(bytes)
        if (result) {
          reader.busy = true
          const completion = result.then(
            () => {
              reader.busy = false
            },
            (error) => {
              readers.delete(reader)
              reader.end(error)
              throw error
            },
          )
          pending = pending ? Promise.all([pending, completion]).then(() => {}) : completion
        }
      } catch (error) {
        readers.delete(reader)
        reader.end(error)
        problem = error
      }
    }
    if (!problem) return pending
    if (!pending) throw problem
    return pending.then(() => {
      throw problem
    })
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
      if (ended) return
      ended = true
      for (const reader of readers) reader.end(error)
      readers.clear()
    },
  }
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
