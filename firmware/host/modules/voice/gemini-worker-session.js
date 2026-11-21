import { createPcmSource } from 'stackchan/voice/media'
import { createVoiceScope, requireActive, voiceError } from 'stackchan/voice/scope'
import Timer from 'timer'

const defaultStyle =
  'A naturally high-pitched, cute, cheerful Japanese virtual character voice, with clear pronunciation, gentle lively intonation and a warm conversational pace. Do not imitate any real person.'

function notify(callback, value) {
  try {
    callback?.(value)
  } catch {}
}

export function createGeminiWorkerTTS(options, startJob) {
  if (typeof startJob !== 'function') throw new TypeError('speech job factory required')
  const timeoutMs = options.timeoutMs ?? 45000
  const pcmIdleTimeoutMs = options.pcmIdleTimeoutMs
  const maxEventBytes = options.maxEventBytes ?? 65536
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('invalid speech deadline')
  if (
    pcmIdleTimeoutMs !== undefined &&
    (!Number.isSafeInteger(pcmIdleTimeoutMs) || pcmIdleTimeoutMs < 1 || pcmIdleTimeoutMs > timeoutMs)
  )
    throw new RangeError('invalid speech inactivity deadline')
  if (!Number.isSafeInteger(maxEventBytes) || maxEventBytes < 256 || maxEventBytes > 65536)
    throw new RangeError('invalid audio event limit')
  const sampleRate = options.sampleRate ?? 24000
  if (sampleRate !== 16000 && sampleRate !== 24000) throw new RangeError('invalid speech rate')
  return {
    capabilities: { input: 'segmented', output: 'streaming' },
    async open({ signal, voice = 'Leda', format }) {
      requireActive(signal)
      if (format.encoding !== 'pcm_s16le' || format.sampleRate !== sampleRate || format.channels !== 1)
        throw voiceError('unsupported_capability')
      const scope = createVoiceScope(signal)
      const source = createPcmSource(format)
      let tail = '',
        buffered = 0,
        sealed = false,
        ended = false,
        failure
      let chain = Promise.resolve(),
        completion
      function abort() {
        failure ??= scope.signal.reason ?? voiceError('cancelled')
        tail = ''
        if (!ended) {
          ended = true
          source.end(failure)
        }
      }
      scope.signal.addEventListener('abort', abort)
      function active() {
        if (failure) throw failure
        requireActive(scope.signal)
      }
      function fail(error) {
        const code = ['cancelled', 'deadline_exceeded', 'resource_exhausted', 'unsupported_capability'].includes(
          error?.code,
        )
          ? error.code
          : 'provider_failed'
        scope.abort(voiceError(code))
        throw failure
      }
      function cancellable(promise) {
        return new Promise((resolve, reject) => {
          const cancel = () => reject(scope.signal.reason ?? voiceError('cancelled'))
          scope.signal.addEventListener('abort', cancel)
          Promise.resolve(promise).then(
            (value) => {
              scope.signal.removeEventListener('abort', cancel)
              resolve(value)
            },
            (error) => {
              scope.signal.removeEventListener('abort', cancel)
              reject(error)
            },
          )
          if (scope.signal.aborted) cancel()
        })
      }
      async function run(text) {
        active()
        const expire = () => scope.abort(voiceError('deadline_exceeded'))
        const timer = Timer.set(expire, timeoutMs)
        let idleTimer

        function acceptPcm(length) {
          active()
          if (length && idleTimer !== undefined) Timer.schedule(idleTimer, pcmIdleTimeoutMs)
        }

        try {
          if (pcmIdleTimeoutMs !== undefined) idleTimer = Timer.set(expire, pcmIdleTimeoutMs)
          await cancellable(
            Promise.resolve().then(() => {
              active()
              return startJob({
                text,
                voice,
                model: options.model ?? 'gemini-3.8-flash-tts',
                instructions: options.instructions ?? defaultStyle,
                timeoutMs,
                maxEventBytes,
                sampleRate,
                signal: scope.signal,
                onPcm(bytes) {
                  active()
                  const length = bytes.length
                  const pending = source.offer(bytes)
                  if (pending) return cancellable(pending).then(() => acceptPcm(length))
                  acceptPcm(length)
                },
                onMetrics: (value) => notify(options.onMetrics, value),
                onFailure: (value) => notify(options.onFailure, value),
              })
            }),
          )
          active()
        } finally {
          if (idleTimer !== undefined) Timer.clear(idleTimer)
          Timer.clear(timer)
          buffered -= text.length
        }
      }
      function enqueueTail() {
        const text = tail
        tail = ''
        if (text.length) {
          chain = chain
            .then(async () => {
              for (let offset = 0; offset < text.length; ) {
                let end = Math.min(text.length, offset + 1024)
                // UTF-16 surrogate pairs must stay within a single provider request.
                if (end < text.length && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) end--
                await run(text.slice(offset, end))
                offset = end
              }
            })
            .catch(fail)
          chain.catch(() => {})
        }
        return chain
      }
      return {
        output: source.output,
        async write(text) {
          active()
          if (sealed) throw voiceError('cancelled')
          if (typeof text !== 'string') throw new TypeError('speech text must be a string')
          if (buffered + text.length > 8192) return fail(voiceError('resource_exhausted'))
          tail += text
          buffered += text.length
        },
        async flush() {
          active()
          if (sealed) throw voiceError('cancelled')
          await enqueueTail()
          active()
        },
        endInput() {
          if (completion) return completion
          sealed = true
          completion = (async () => {
            active()
            await enqueueTail()
            active()
            ended = true
            source.end()
            scope.dispose()
          })()
          completion.catch(() => {})
          return completion
        },
        async close() {
          sealed = true
          if (!ended) scope.abort(voiceError('cancelled'))
          scope.signal.removeEventListener('abort', abort)
          scope.dispose()
        },
      }
    },
  }
}
