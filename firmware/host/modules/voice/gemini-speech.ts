import type { STT, TTS } from 'stackchan/voice/contracts'
import { createPcmSink, createPcmSource } from 'stackchan/voice/media'
import { createVoiceScope, requireActive, voiceError } from 'stackchan/voice/scope'
import { base64 } from 'stackchan-ai-image'
import { type Body, consumeSSE, jsonBody, type SendResponseRequest } from 'stackchan-ai-wire'
import Timer from 'timer'

type Options = { request: SendResponseRequest; model?: string; timeoutMs?: number }
const defaultStyle =
  'A naturally high-pitched, cute, cheerful Japanese virtual character voice, with clear pronunciation, gentle lively intonation and a warm conversational pace. Do not imitate any real person.'
const digits = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

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

export function createGeminiSTT(options: Options & { language?: string; maxAudioBytes?: number }): STT {
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
                yield prefix
                yield* base64(
                  (function* () {
                    for (let i = 0; i < audio.length; i += 768) yield audio.subarray(i, i + 768)
                  })(),
                )
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

function validBase64(data: unknown): asserts data is string {
  if (typeof data !== 'string' || !data.length || data.length % 4)
    throw voiceError('provider_failed', 'invalid audio encoding')
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  const encoded = new Uint8Array(ArrayBuffer.fromString(data))
  for (let i = 0, length = encoded.length - padding; i < length; i++) {
    const c = encoded[i]
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 47))
      throw voiceError('provider_failed', 'invalid audio encoding')
  }
  const last = digits.indexOf(data[data.length - padding - 1])
  if ((padding === 2 && last & 15) || (padding === 1 && last & 3))
    throw voiceError('provider_failed', 'invalid audio padding')
}

export function createGeminiSpeechTTS(
  options: Options & {
    instructions?: string
    maxEventBytes?: number
    onMetrics?: (metrics: { maxEventChars: number; pcmBytes: number }) => void
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
          bytesHeard = 0,
          leftover: number | undefined
        const pcm = new Uint8Array(1024)
        const consume = consumeSSE(eventLimit, scope, async (json) => {
          maxEventChars = Math.max(maxEventChars, json.length)
          requireActive(scope.signal)
          const event = parseObject(json)
          if (completed) throw voiceError('provider_failed', 'event after speech completion')
          if (event?.event_type === 'error' || event?.error) throw voiceError('provider_failed', 'Gemini speech failed')
          if (event?.event_type === 'interaction.completed') {
            if (
              !object(event.interaction) ||
              event.interaction.status !== 'completed' ||
              !bytesHeard ||
              leftover !== undefined
            )
              throw voiceError('provider_failed', 'incomplete speech audio')
            completed = true
          } else if (event?.event_type === 'step.delta' && object(event.delta) && event.delta.type === 'audio') {
            const { data, mime_type: mime } = event.delta
            if (
              mime !== undefined &&
              (typeof mime !== 'string' || !/^audio\/l16(?:;rate=24000)?(?:;channels=1)?$/i.test(mime))
            )
              throw voiceError('unsupported_capability', 'unexpected speech audio format')
            validBase64(data)
            const decoded = (data.length / 4) * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0)
            if (bytesHeard + decoded > 5760000) throw voiceError('resource_exhausted', 'speech audio exceeds limit')
            let used = 0
            if (leftover !== undefined) {
              pcm[used++] = leftover
              leftover = undefined
            }
            const nativeDecode = (
              Uint8Array as typeof Uint8Array & {
                fromBase64?: (data: string, options: { lastChunkHandling: string }) => Uint8Array
              }
            ).fromBase64
            let decodedBytes: Uint8Array
            if (nativeDecode) {
              try {
                decodedBytes = nativeDecode(data, { lastChunkHandling: 'strict' })
              } catch (error) {
                if (error instanceof SyntaxError) throw voiceError('provider_failed', 'invalid audio encoding')
                throw error
              }
              if (decodedBytes.length !== decoded) throw voiceError('provider_failed', 'invalid audio length')
            } else {
              decodedBytes = new Uint8Array(decoded)
              for (let at = 0, to = 0; at < data.length; at += 4) {
                const a = digits.indexOf(data[at]),
                  b = digits.indexOf(data[at + 1]),
                  c = digits.indexOf(data[at + 2]),
                  d = digits.indexOf(data[at + 3])
                const value = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d)
                const count = c < 0 ? 1 : d < 0 ? 2 : 3
                for (let i = 0; i < count; i++) decodedBytes[to++] = (value >>> (16 - i * 8)) & 255
              }
            }
            for (let at = 0; at < decodedBytes.length; ) {
              const count = Math.min(pcm.length - used, decodedBytes.length - at)
              pcm.set(decodedBytes.subarray(at, at + count), used)
              used += count
              at += count
              if (used === pcm.length) {
                requireActive(scope.signal)
                await source.offer(pcm)
                requireActive(scope.signal)
                used = 0
              }
            }
            if (used & 1) leftover = pcm[--used]
            if (used) {
              await source.offer(pcm.subarray(0, used))
              requireActive(scope.signal)
            }
            bytesHeard += decoded
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
