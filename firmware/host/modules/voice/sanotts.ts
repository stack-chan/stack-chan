import NativeSanoTTS from 'sanotts-native'
import type { Synthesis, TTS } from 'stackchan/voice/contracts'
import { createPcmSource, readSource } from 'stackchan/voice/media'
import { toKana } from 'stackchan/voice/sanotts-reading'
import { createVoiceScope, deferred, requireActive, voiceError } from 'stackchan/voice/scope'
import Timer from 'timer'

export function createSanoTTS(options: { toKana?: (text: string) => string } = {}): TTS & { openKana: TTS['open'] } {
  const readText = options.toKana ?? toKana
  async function openSegment(
    { signal, format }: Parameters<TTS['open']>[0],
    kana: boolean,
  ): Promise<Omit<Synthesis, 'flush'>> {
    requireActive(signal)
    const source = createPcmSource(format)
    let text = '',
      ended = false
    let error: unknown
    let native: NativeSanoTTS | undefined
    let completion: ReturnType<typeof deferred<void>> | undefined
    let timer: ReturnType<typeof Timer.set> | undefined
    let released: ReturnType<typeof deferred<void>> | undefined
    const abort = () => end(signal.reason ?? voiceError('cancelled'))
    function end(reason?: unknown) {
      if (ended) return
      ended = true
      error = reason
      signal.removeEventListener('abort', abort)
      if (timer !== undefined) Timer.clear(timer)
      const renderer = native
      native = undefined
      const releaseResult = deferred<void>()
      released = releaseResult
      void releaseResult.promise.catch(() => {})
      function release() {
        try {
          if (renderer && !renderer.done) {
            Timer.set(release, 5)
            return
          }
          renderer?.close()
        } catch (failure) {
          error ??= failure
          releaseResult.reject(failure)
        }
        try {
          source.end(error)
        } finally {
          if (error) completion?.reject(error)
          else completion?.resolve()
          releaseResult.resolve()
        }
      }
      renderer?.stop()
      release()
    }
    function start() {
      const input = kana ? text : readText(text)
      if (ended) throw error ?? voiceError('cancelled')
      if (typeof input !== 'string') throw new TypeError('reading must return a string')
      if (input.includes('\0')) throw new TypeError('reading contains NUL')
      native = new NativeSanoTTS()
      native.start(input)
      const bytes = new Uint8Array(2048)
      let primed = false
      async function pump() {
        timer = undefined
        try {
          if (!native || ended) return
          if (!primed && native.available < 12288 && !native.done) {
            timer = Timer.set(pump, 10)
            return
          }
          primed = true
          for (let index = 0; index < 4 && native && !ended; index++) {
            const samples = native.read(bytes.buffer)
            if (samples === -1) return end()
            if (!samples) break
            if (!Number.isInteger(samples) || samples < 0 || samples * 2 > bytes.length)
              throw voiceError('provider_failed', 'invalid sanoTTS PCM length')
            const pending = source.offer(samples * 2 === bytes.length ? bytes : bytes.subarray(0, samples * 2))
            if (pending) await pending
          }
          if (!ended) timer = Timer.set(pump, native?.available ? 0 : 5)
        } catch (e) {
          end(e)
        }
      }
      void pump()
    }
    signal.addEventListener('abort', abort)
    return {
      output: source.output,
      async write(part) {
        if (ended || completion) throw error ?? voiceError('cancelled')
        if (text.length + part.length > 512) throw voiceError('resource_exhausted', 'utterance exceeds 512 characters')
        if (part.includes('\0')) throw new TypeError('utterance contains NUL')
        text += part
      },
      endInput() {
        if (completion) return completion.promise
        if (ended) return Promise.reject(error)
        completion = deferred<void>()
        try {
          if (text) start()
          else end()
        } catch (e) {
          end(e)
        }
        return completion.promise
      },
      async close() {
        end(voiceError('cancelled'))
        await released?.promise
      },
    }
  }
  async function open(options: Parameters<TTS['open']>[0], kana: boolean): Promise<Synthesis> {
    const { signal, format, voice } = options
    requireActive(signal)
    if (format.channels !== 1 || format.sampleRate !== 24000 || format.encoding !== 'pcm_s16le')
      throw voiceError('unsupported_capability', 'sanoTTS requires mono 24 kHz PCM')
    if (voice && voice !== 'default') throw voiceError('unsupported_capability', 'sanoTTS provides the default voice')
    const scope = createVoiceScope(signal)
    const source = createPcmSource(format)
    type Segment = Awaited<ReturnType<typeof openSegment>>
    type Running = { segment: Promise<Segment>; done: Promise<void>; closing?: Promise<void> }
    let text = ''
    let active: Running | undefined
    let ending: Promise<void> | undefined
    let closing: Promise<void> | undefined
    let failure: unknown
    let releaseFailure: { cause: unknown } | undefined

    function requireWritable() {
      requireActive(scope.signal)
      if (failure) throw failure
      if (ending || closing) throw voiceError('cancelled')
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
        requireActive(scope.signal)
        let reader: ReturnType<typeof readSource> | undefined
        try {
          reader = readSource(segment.output, source.offer)
          await segment.write(part)
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
      const segment = openSegment({ ...options, signal: scope.signal }, kana)
      const run: Running = { segment, done: Promise.resolve() }
      active = run
      run.done = render(run, part)
      return run.done
    }
    function dispose() {
      scope.signal.removeEventListener('abort', abort)
      scope.dispose()
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
        if (text.length + part.length > 512) throw voiceError('resource_exhausted', 'utterance exceeds 512 characters')
        if (part.includes('\0')) throw new TypeError('utterance contains NUL')
        text += part
      },
      async flush() {
        requireWritable()
        if (active) throw voiceError('device_busy', 'await the previous speech flush')
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
  return {
    capabilities: { input: 'segmented', output: 'streaming' },
    open: (options) => open(options, false),
    openKana: (options) => open(options, true),
  }
}
