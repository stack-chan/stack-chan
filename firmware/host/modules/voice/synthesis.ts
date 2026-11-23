import type { Synthesis, TTS } from 'stackchan/voice/contracts'
import { createPcmSource, readSource } from 'stackchan/voice/media'
import { createVoiceScope, requireActive, voiceError } from 'stackchan/voice/scope'

type OpenOptions = Parameters<TTS['open']>[0]
type Segment = Omit<Synthesis, 'flush'>
const maxSessionCharacters = 4096
const maxSegments = 64

export async function openStreamingSynthesis(
  options: OpenOptions,
  openSegment: (options: OpenOptions) => Promise<Segment>,
  maxSegmentCharacters: number,
  onRelease?: () => void,
): Promise<Synthesis> {
  const { signal, format } = options
  let source: ReturnType<typeof createPcmSource>
  let scope: ReturnType<typeof createVoiceScope>
  try {
    requireActive(signal)
    if (
      format.encoding !== 'pcm_s16le' ||
      (format.channels !== 1 && format.channels !== 2) ||
      !Number.isSafeInteger(format.sampleRate) ||
      format.sampleRate <= 0
    )
      throw new RangeError('invalid synthesis PCM format')
    source = createPcmSource(format)
    scope = createVoiceScope(signal)
  } catch (error) {
    onRelease?.()
    throw error
  }
  type Running = { segment: Promise<Segment>; done: Promise<void>; closing?: Promise<void> }
  let text = ''
  let acceptedCharacters = 0
  let segments = 0
  let released = false
  let active: Running | undefined
  let ending: Promise<void> | undefined
  let closing: Promise<void> | undefined
  let failure: unknown
  let releaseFailure: { cause: unknown } | undefined

  function requireWritable() {
    requireActive(scope.signal)
    if (failure) throw failure
    if (ending || closing) throw voiceError('cancelled')
    if (active) throw voiceError('device_busy', 'await the previous speech flush')
  }
  function closeSegment(run: Running) {
    run.closing ??= run.segment.then(
      async (segment) => {
        try {
          await segment.close()
        } catch (cause) {
          releaseFailure = { cause }
          throw cause
        }
      },
      () => {},
    )
    return run.closing
  }
  async function render(run: Running, part: string) {
    try {
      const segment = await run.segment
      let reader: ReturnType<typeof readSource> | undefined
      try {
        requireActive(scope.signal)
        reader = readSource(segment.output, source.offer)
        await segment.write(part)
        requireActive(scope.signal)
        await segment.endInput()
      } finally {
        try {
          reader?.close()
        } finally {
          await closeSegment(run)
        }
      }
    } catch (error) {
      failure = error
      source.end(error)
      throw error
    } finally {
      active = undefined
    }
  }
  function flushPending() {
    if (!text) return Promise.resolve()
    const part = text
    text = ''
    segments++
    const segment = Promise.resolve().then(() => openSegment({ ...options, signal: scope.signal }))
    const run: Running = { segment, done: Promise.resolve() }
    active = run
    run.done = render(run, part)
    return run.done
  }
  function dispose() {
    scope.signal.removeEventListener('abort', abort)
    scope.dispose()
    if (!released && !releaseFailure) {
      released = true
      onRelease?.()
    }
  }
  function close() {
    if (closing) return closing
    const run = active
    const reason = scope.signal.reason ?? voiceError('cancelled')
    closing = Promise.resolve().then(async () => {
      try {
        try {
          source.end(reason)
        } finally {
          if (run) {
            await closeSegment(run).catch(() => {})
            await run.done.catch(() => {})
          }
        }
        if (releaseFailure) throw releaseFailure.cause
      } finally {
        dispose()
      }
    })
    scope.abort(reason)
    return closing
  }
  function abort() {
    void close().catch(() => {})
  }
  scope.signal.addEventListener('abort', abort)
  return {
    output: source.output,
    async write(part) {
      requireWritable()
      if (!part.length) return
      if (part.includes('\0')) throw new TypeError('utterance contains NUL')
      if (
        segments >= maxSegments ||
        text.length + part.length > maxSegmentCharacters ||
        acceptedCharacters + part.length > maxSessionCharacters
      )
        throw voiceError('resource_exhausted', 'speech segment budget exceeded')
      acceptedCharacters += part.length
      text += part
    },
    async flush() {
      requireWritable()
      await flushPending()
    },
    endInput() {
      ending ??= Promise.resolve().then(async () => {
        try {
          if (active) await active.done
          requireActive(scope.signal)
          if (failure) throw failure
          await flushPending()
          source.end()
        } finally {
          dispose()
        }
      })
      return ending
    },
    close,
  }
}
