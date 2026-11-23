import type { STT, TTS } from 'stackchan/voice/contracts'
import { createBase64PcmWriter } from 'stackchan/voice/pcm-base64'
import { createPcmSink, createPcmSource } from 'stackchan/voice/media'
import { createVoiceScope, requireActive, voiceError } from 'stackchan/voice/scope'
import { base64 } from 'stackchan-ai-image'
import { type Body, consumeSSE, jsonBody, type SendResponseRequest } from 'stackchan-ai-wire'
import Timer from 'timer'

type Options = { request: SendResponseRequest; model?: string; timeoutMs?: number }
const defaultStyle =
  'A naturally high-pitched, cute, cheerful Japanese virtual character voice, with clear pronunciation, gentle lively intonation and a warm conversational pace. Do not imitate any real person.'

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseObject(text: string) {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw voiceError('provider_failed', 'invalid speech response')
  }
  if (!object(value)) throw voiceError('provider_failed', 'invalid speech response')
  return value
}

function settings(options: Options) {
  if (typeof options.request !== 'function') throw new TypeError('Gemini speech requires a request transport')
  const timeout = options.timeoutMs ?? 45000
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120000) throw new RangeError('invalid speech timeout')
  return timeout
}

async function request(
  options: Options,
  timeout: number,
  body: Body,
  consume: (bytes: Uint8Array) => Promise<void>,
  parent: ReturnType<typeof createVoiceScope>,
  complete?: () => boolean,
  idleTimeout = false,
) {
  const scope = createVoiceScope(parent.signal)
  let settled = false
  let timer: ReturnType<typeof Timer.set> | undefined
  let totalTimer: ReturnType<typeof Timer.set> | undefined
  let abort: () => void = () => {}
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(scope.signal.reason ?? voiceError('cancelled'))
    scope.signal.addEventListener('abort', abort)
    if (scope.signal.aborted) abort()
  })
  const active = () => {
    requireActive(scope.signal)
    if (settled) throw voiceError('cancelled')
  }
  try {
    active()
    timer = Timer.set(() => parent.abort(voiceError('deadline_exceeded')), timeout)
    if (idleTimeout) totalTimer = Timer.set(() => parent.abort(voiceError('deadline_exceeded')), 180000)
    await Promise.race([
      Promise.resolve().then(() => {
        active()
        return options.request(
          {
            length: body.length,
            *read() {
              for (const bytes of body.read()) {
                active()
                yield bytes
              }
            },
          },
          async (bytes) => {
            active()
            if (idleTimeout && timer !== undefined) Timer.clear(timer)
            await consume(bytes)
            active()
            if (idleTimeout) timer = Timer.set(() => parent.abort(voiceError('deadline_exceeded')), timeout)
          },
          scope,
          complete,
        )
      }),
      cancelled,
    ])
    active()
  } catch (error) {
    parent.abort(error)
    throw error
  } finally {
    settled = true
    if (timer !== undefined) Timer.clear(timer)
    if (totalTimer !== undefined) Timer.clear(totalTimer)
    scope.signal.removeEventListener('abort', abort)
    scope.dispose()
  }
}

function wav(bytes: Uint8Array, length: number) {
  const header = new DataView(bytes.buffer, bytes.byteOffset, 44)
  const tag = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i)
  }
  tag(0, 'RIFF')
  header.setUint32(4, length + 36, true)
  tag(8, 'WAVEfmt ')
  header.setUint32(16, 16, true)
  header.setUint16(20, 1, true)
  header.setUint16(22, 1, true)
  header.setUint32(24, 16000, true)
  header.setUint32(28, 32000, true)
  header.setUint16(32, 2, true)
  header.setUint16(34, 16, true)
  tag(36, 'data')
  header.setUint32(40, length, true)
}

type STTTiming = { now(): number; emit(values: number[]): void }
type Base64Bytes = Uint8Array & { toBase64?: () => string }

function* encodeWav(audio: Uint8Array) {
  const toBase64 = (audio as Base64Bytes).toBase64
  if (typeof toBase64 === 'function') {
    // 中間ブロックに padding が入らないように、入力長を 3 の倍数にする
    const block = new Uint8Array(3072)
    for (let i = 0; i < audio.length; i += block.length) {
      const chunk = audio.subarray(i, i + block.length)
      // SharedArrayBuffer の非ゼロオフセットを無視するエンコーダがある
      block.set(chunk)
      yield new Uint8Array(ArrayBuffer.fromString(toBase64.call(block.subarray(0, chunk.length))))
    }
  } else {
    yield* base64([audio])
  }
}

export function createGeminiSTT(
  options: Options & { language?: string; maxAudioBytes?: number; timing?: STTTiming },
): STT {
  const timeout = settings(options)
  const limit = options.maxAudioBytes ?? 480000
  if (!Number.isSafeInteger(limit) || limit < 2 || limit > 480000 || limit % 2)
    throw new RangeError('invalid recording limit')
  return {
    async open({ signal, format, utteranceId, onTranscript }) {
      requireActive(signal)
      if (format.encoding !== 'pcm_s16le' || format.channels !== 1 || format.sampleRate !== 16000)
        throw voiceError('unsupported_capability', 'Gemini transcription requires 16 kHz mono PCM')
      let recording: Uint8Array = new Uint8Array(new SharedArrayBuffer(limit + 44))
      const scope = createVoiceScope(signal)
      let used = 44,
        ended = false,
        finishing: Promise<void> | undefined
      const release = () => {
        recording.fill(0)
        recording = new Uint8Array(0)
      }
      return {
        input: createPcmSink(format, (bytes) => {
          requireActive(scope.signal)
          if (ended || bytes.length % 2 || used + bytes.length > recording.length) throw voiceError('input_overrun')
          recording.set(bytes, used)
          used += bytes.length
        }),
        finish() {
          if (finishing) return finishing
          ended = true
          finishing = (async () => {
            requireActive(scope.signal)
            if (used === 44) {
              onTranscript({ utteranceId, text: '', final: true })
              return
            }
            const timing = options.timing
            const started = timing?.now() ?? 0
            let writable: number | undefined,
              audioAccepted: number | undefined,
              firstResponse: number | undefined
            wav(recording, used - 44)
            const prefix = new Uint8Array(
              ArrayBuffer.fromString(
                JSON.stringify({
                  model: options.model ?? 'gemini-3.5-transcribe',
                  store: false,
                  stream: false,
                  generation_config: {
                    transcription_config: { language_codes: [options.language ?? 'ja-JP'], mode: { type: 'verbatim' } },
                  },
                }).slice(0, -1) + ',"input":[{"type":"audio","mime_type":"audio/wav","data":"',
              ),
            )
            const suffix = new Uint8Array(ArrayBuffer.fromString('"}]}'))
            const audio = recording.subarray(0, used)
            const body: Body = {
              length: prefix.length + 4 * Math.ceil(audio.length / 3) + suffix.length,
              *read() {
                writable = timing?.now()
                yield prefix
                yield* encodeWav(audio)
                audioAccepted = timing?.now()
                yield suffix
              },
            }
            const response = new Uint8Array(32768)
            let count = 0
            await request(
              options,
              timeout,
              body,
              async (bytes) => {
                if (firstResponse === undefined) firstResponse = timing?.now()
                if (count + bytes.length > response.length)
                  throw voiceError('resource_exhausted', 'transcription response too large')
                response.set(bytes, count)
                count += bytes.length
              },
              scope,
            )
            requireActive(scope.signal)
            const result = parseObject(String.fromArrayBuffer(response.buffer.slice(0, count)))
            if (result?.status !== 'completed' || result.error || !Array.isArray(result.steps))
              throw voiceError('provider_failed', 'incomplete transcription')
            const texts: string[] = []
            for (const step of result.steps) {
              if (!object(step) || step.type !== 'model_output' || !Array.isArray(step.content)) continue
              for (const item of step.content)
                if (object(item) && item.type === 'text' && typeof item.text === 'string') texts.push(item.text)
            }
            if (!texts.length) throw voiceError('provider_failed', 'missing transcription')
            const text = texts.join('')
            if (text.length > 4096) throw voiceError('resource_exhausted', 'transcription too long')
            if (timing && writable !== undefined && audioAccepted !== undefined && firstResponse !== undefined) {
              try {
                timing.emit([
                  used - 44,
                  (writable - started) >>> 0,
                  (audioAccepted - writable) >>> 0,
                  (firstResponse - audioAccepted) >>> 0,
                  (timing.now() - firstResponse) >>> 0,
                ])
              } catch {}
            }
            onTranscript({ utteranceId, text, final: true })
          })().finally(release)
          return finishing
        },
        async close() {
          ended = true
          scope.abort()
          if (finishing) await finishing.catch(() => {})
          release()
          scope.dispose()
        },
      }
    },
  }
}

export function createGeminiSpeechTTS(
  options: Options & {
    instructions?: string
    maxEventBytes?: number
    onMetrics?: (metrics: { maxEventChars: number; pcmBytes: number }) => void
    onFailure?: (reason: number) => void
  },
): TTS {
  const timeout = settings(options)
  const eventLimit = options.maxEventBytes ?? 65536
  if (!Number.isSafeInteger(eventLimit) || eventLimit < 256 || eventLimit > 65536)
    throw new RangeError('invalid audio event limit')
  return {
    capabilities: { input: 'segmented', output: 'streaming' },
    async open({ signal, format, voice }) {
      requireActive(signal)
      if (format.encoding !== 'pcm_s16le' || format.channels !== 1 || format.sampleRate !== 24000)
        throw voiceError('unsupported_capability', 'Gemini speech requires 24 kHz mono PCM')
      const scope = createVoiceScope(signal),
        source = createPcmSource(format)
      let text = '',
        sealed = false,
        failure: unknown,
        active: Promise<void> | undefined,
        ending: Promise<void> | undefined
      const abort = () => {
        sealed = true
        text = ''
        source.end(scope.signal.reason ?? voiceError('cancelled'))
      }
      scope.signal.addEventListener('abort', abort)
      const writable = () => {
        requireActive(scope.signal)
        if (failure) throw failure
        if (sealed) throw voiceError('cancelled')
      }
      const synthesize = () => {
        requireActive(scope.signal)
        if (failure) throw failure
        if (active) throw voiceError('device_busy')
        if (!text) return Promise.resolve()
        const segment = text
        text = ''
        const body = jsonBody(
          {
            model: options.model ?? 'gemini-3.8-flash-tts',
            store: false,
            stream: true,
            input: [
              {
                type: 'user_input',
                content: [
                  {
                    type: 'text',
                    text: segment,
                    annotations: [{ type: 'speech_metadata', style: options.instructions ?? defaultStyle }],
                  },
                ],
              },
            ],
            response_format: { type: 'audio' },
            generation_config: { speech_config: [{ voice: voice || 'Leda' }] },
          },
          24576,
        )
        let completed = false,
          maxEventChars = 0,
          bytesHeard = 0
        const audio = createBase64PcmWriter(scope.signal, source.offer, 5760000)
        const consume = consumeSSE(eventLimit, scope, async (json) => {
          maxEventChars = Math.max(maxEventChars, json.length)
          requireActive(scope.signal)
          const event = parseObject(json)
          if (completed) throw voiceError('provider_failed', 'event after speech completion')
          if (event?.event_type === 'error' || event?.error) throw voiceError('provider_failed', 'Gemini speech failed')
          if (event?.event_type === 'interaction.completed') {
            if (!object(event.interaction) || event.interaction.status !== 'completed' || !bytesHeard || audio.partial)
              throw voiceError('provider_failed', 'incomplete speech audio')
            completed = true
          } else if (event?.event_type === 'step.delta' && object(event.delta) && event.delta.type === 'audio') {
            const { data, mime_type: mime } = event.delta
            if (
              mime !== undefined &&
              (typeof mime !== 'string' || !/^audio\/l16(?:;rate=24000)?(?:;channels=1)?$/i.test(mime))
            )
              throw voiceError('unsupported_capability', 'unexpected speech audio format')
            if (typeof data !== 'string') throw voiceError('provider_failed', 'invalid audio encoding')
            await audio.write(data)
            bytesHeard = audio.bytes
          }
        })
        active = request(options, timeout, body, consume, scope, () => completed, true)
          .then(() => {
            if (!completed) throw voiceError('provider_failed', 'speech stream ended without completion')
          })
          .then(
            () => {
              active = undefined
            },
            (error) => {
              active = undefined
              failure = error
              // Report only fixed categories, never provider bodies or exception text.
              try {
                const message = error instanceof Error ? error.message : ''
                const reasons = [
                  'invalid speech response',
                  'event after speech completion',
                  'Gemini speech failed',
                  'incomplete speech audio',
                  'invalid audio encoding',
                  'invalid audio padding',
                  'invalid audio length',
                  'speech stream ended without completion',
                  'Responses connection closed early',
                  'unexpected speech audio format',
                ]
                const index = reasons.indexOf(message)
                options.onFailure?.(
                  index >= 0
                    ? index + 1
                    : message.startsWith('Responses connection failed')
                      ? 11
                      : /^Responses HTTP [1-5][0-9]{2}$/.test(message)
                        ? 12
                        : (error as { code?: string })?.code === 'deadline_exceeded'
                          ? 13
                          : 0,
                )
              } catch {}
              text = ''
              scope.abort(error)
              source.end(error)
              throw error
            },
          )
        active = active.finally(() => {
          try {
            options.onMetrics?.({ maxEventChars, pcmBytes: bytesHeard })
          } catch {}
        })
        return active
      }
      return {
        output: source.output,
        async write(part) {
          writable()
          if (text.length + part.length > 4096) throw voiceError('resource_exhausted')
          text += part
        },
        async flush() {
          writable()
          await synthesize()
        },
        endInput() {
          if (ending) return ending
          sealed = true
          ending = (async () => {
            try {
              if (active) await active
              await synthesize()
              source.end()
              scope.signal.removeEventListener('abort', abort)
              scope.dispose()
            } catch (error) {
              source.end(error)
              throw error
            }
          })()
          return ending
        },
        async close() {
          sealed = true
          text = ''
          scope.abort()
          source.end(voiceError('cancelled'))
          if (active) await active.catch(() => {})
          scope.signal.removeEventListener('abort', abort)
          scope.dispose()
        },
      }
    },
  }
}

export const GeminiTranscribeSTT = { create: createGeminiSTT }
export const GeminiSpeechTTS = { create: createGeminiSpeechTTS }
