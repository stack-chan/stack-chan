import type { Synthesis, TTS } from 'stackchan/voice/contracts'
import { createPcmSource, readSource } from 'stackchan/voice/media'
import { createVoiceScope, deferred, requireActive, voiceError } from 'stackchan/voice/scope'

type SegmentSynthesis = Omit<Synthesis, 'flush'>
type OpenOptions = Parameters<TTS['open']>[0]

export async function openStreamingSynthesis(
  options: OpenOptions,
  openSegment: (options: OpenOptions) => Promise<SegmentSynthesis>,
  maxSegmentCharacters: number,
  onRelease?: () => void,
): Promise<Synthesis> {
  const scope = createVoiceScope(options.signal)
  const source = createPcmSource(options.format)
  let current: SegmentSynthesis | undefined
  let subscription: ReturnType<typeof readSource> | undefined
  let active: { kind: 'write' | 'flush'; promise: Promise<void> } | undefined
  let finishing: Promise<void> | undefined
  let closing: Promise<void> | undefined
  let textCharacters = 0,
    segmentCharacters = 0,
    segments = 0,
    ended = false,
    released = false
  let failure: unknown
  let releaseFailure: { error: unknown } | undefined

  function release() {
    if (released) return
    released = true
    scope.signal.removeEventListener('abort', abort)
    scope.dispose()
    onRelease?.()
  }
  async function open() {
    requireActive(scope.signal)
    const segment = await openSegment({ ...options, signal: scope.signal })
    if (scope.signal.aborted || ended) {
      await disposeSegment(segment)
      throw scope.signal.reason ?? voiceError('cancelled')
    }
    current = segment
    return segment
  }
  async function disposeSegment(segment: SegmentSynthesis) {
    try {
      await segment.close()
    } catch (error) {
      releaseFailure ??= { error }
      throw error
    }
  }
  async function closeSegment() {
    subscription?.close()
    subscription = undefined
    const segment = current
    current = undefined
    if (segment) await disposeSegment(segment)
  }
  function close() {
    if (closing) return closing
    ended = true
    failure ??= voiceError('cancelled')
    const result = deferred<void>()
    closing = result.promise
    scope.abort(failure)
    source.end(failure)
    const operation = active?.promise
    async function releaseResources() {
      try {
        // abort通知中の同期的な再入でXSのスタックを使い切らないよう、資源の回収は通知が戻ってから始める
        await Promise.resolve()
        await closeSegment().catch(() => {})
        await operation?.catch(() => {})
        await closeSegment().catch(() => {})
        if (releaseFailure) throw releaseFailure.error
        release()
        result.resolve()
      } catch (error) {
        result.reject(error)
      }
    }
    void releaseResources()
    return closing
  }
  function abort() {
    failure ??= scope.signal.reason ?? voiceError('cancelled')
    void close().catch(() => {})
  }
  function run(kind: 'write' | 'flush', operation: () => Promise<void>) {
    const result = deferred<void>()
    const record = { kind, promise: result.promise }
    active = record
    void operation().then(
      () => {
        if (active === record) active = undefined
        result.resolve()
      },
      (error) => {
        if (active === record) active = undefined
        result.reject(error)
      },
    )
    return result.promise
  }
  function requireWritable() {
    requireActive(scope.signal)
    if (ended || finishing) throw failure ?? voiceError('cancelled', 'synthesis input closed')
    if (active) throw voiceError('device_busy', 'await the previous synthesis operation')
  }
  function flush() {
    try {
      requireWritable()
    } catch (error) {
      return Promise.reject(error)
    }
    return flushPending()
  }
  function flushPending() {
    if (!segmentCharacters) return Promise.resolve()
    if (segments >= 64) return Promise.reject(voiceError('resource_exhausted', 'too many speech segments'))
    return run('flush', async () => {
      const segment = current
      segments++
      try {
        if (!segment) throw voiceError('cancelled')
        subscription = readSource(segment.output, (bytes) => {
          requireActive(scope.signal)
          return source.offer(bytes)
        })
        await segment.finish()
        requireActive(scope.signal)
        segmentCharacters = 0
        await closeSegment()
      } catch (error) {
        failure = error
        ended = true
        scope.abort(error)
        source.end(error)
        throw error
      }
    })
  }

  try {
    requireActive(scope.signal)
    await open()
    requireActive(scope.signal)
    scope.signal.addEventListener('abort', abort)
  } catch (error) {
    failure = error
    await close()
    throw error
  }

  return {
    output: source.output,
    write(part) {
      try {
        requireWritable()
        if (textCharacters + part.length > 4096 || segmentCharacters + part.length > maxSegmentCharacters)
          throw voiceError('resource_exhausted', 'speech text too long')
      } catch (error) {
        return Promise.reject(error)
      }
      return run('write', async () => {
        const segment = current ?? (await open())
        await segment.write(part)
        requireActive(scope.signal)
        textCharacters += part.length
        segmentCharacters += part.length
      })
    },
    flush,
    finish() {
      if (finishing) return finishing
      if (active?.kind === 'write') return Promise.reject(voiceError('device_busy'))
      const result = deferred<void>()
      finishing = result.promise
      let pending: Promise<void>
      try {
        requireActive(scope.signal)
        if (ended) throw failure ?? voiceError('cancelled')
        pending = active?.promise ?? flushPending()
      } catch (error) {
        pending = Promise.reject(error)
      }
      async function finishOutput() {
        try {
          await pending
          requireActive(scope.signal)
          await closeSegment()
          ended = true
          source.end()
          release()
          result.resolve()
        } catch (error) {
          failure = error
          await close().catch(() => {})
          result.reject(error)
        }
      }
      void finishOutput()
      return finishing
    },
    close,
  }
}
