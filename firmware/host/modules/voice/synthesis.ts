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
  const boundaries: { frames: number; characters: number }[] = []
  let current: SegmentSynthesis | undefined
  let subscription: ReturnType<typeof readSource> | undefined
  let active: { kind: 'write' | 'flush'; promise: Promise<void> } | undefined
  let finishing: Promise<void> | undefined
  let closing: Promise<void> | undefined
  let text = '',
    segmentText = '',
    frames = 0,
    segments = 0,
    ended = false,
    released = false,
    aligned = true
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
    void (async () => {
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
    })()
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
    if (!segmentText) return Promise.resolve()
    if (segments >= 64) return Promise.reject(voiceError('resource_exhausted', 'too many speech segments'))
    return run('flush', async () => {
      const segment = current
      const startFrames = frames
      const characters = text.length
      segments++
      try {
        if (!segment) throw voiceError('cancelled')
        subscription = readSource(segment.output, (bytes) => {
          requireActive(scope.signal)
          const accepted = source.offer(bytes)
          frames += bytes.length / (options.format.channels * 2)
          return accepted
        })
        await segment.finish()
        requireActive(scope.signal)
        const progress = segment.textAt({
          basis: 'estimate',
          renderedFrames: frames - startFrames,
          sampleRate: options.format.sampleRate,
        })
        aligned &&= frames > startFrames && progress.basis !== 'unknown' && progress.text === segmentText
        if (aligned) boundaries.push({ frames, characters })
        segmentText = ''
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
        if (text.length + part.length > 4096 || segmentText.length + part.length > maxSegmentCharacters)
          throw voiceError('resource_exhausted', 'speech text too long')
      } catch (error) {
        return Promise.reject(error)
      }
      return run('write', async () => {
        const segment = current ?? (await open())
        await segment.write(part)
        requireActive(scope.signal)
        text += part
        segmentText += part
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
      void (async () => {
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
      })()
      return finishing
    },
    textAt(position) {
      if (
        position.basis === 'unknown' ||
        !Number.isFinite(position.sampleRate) ||
        position.sampleRate <= 0 ||
        !Number.isFinite(position.renderedFrames) ||
        position.renderedFrames < 0
      )
        return { text: '', basis: 'unknown' }
      const rendered = (position.renderedFrames / position.sampleRate) * options.format.sampleRate
      for (let index = boundaries.length - 1; index >= 0; index--) {
        const boundary = boundaries[index]
        if (rendered >= boundary.frames) return { text: text.slice(0, boundary.characters), basis: 'completed-segment' }
      }
      return { text: '', basis: 'unknown' }
    },
    close,
  }
}
