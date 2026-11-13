import { createClosingClient } from 'realtimeConversation/http-core'
import type HTTPClient from 'embedded:network/http/client'
import type { HTTPClientProvider } from 'embedded:network/http/client'
import Headers from 'headers'
import type { PcmFormat, STT, TTS, VoiceSignal } from 'stackchan/voice/contracts'
import { createPcmSink, createPcmSource } from 'stackchan/voice/media'
import { createPcmBodyReader } from 'stackchan/voice/pcm-http'
import { createVoiceScope, requireActive, voiceError } from 'stackchan/voice/scope'
import Whisper from 'stt-whisper'
import Timer from 'timer'

declare const device: { network: { https: { client: HTTPClientProvider } } }

function waveHeader(bytes: Uint8Array, format: PcmFormat, length: number) {
  const header = new DataView(bytes.buffer, bytes.byteOffset, 44)
  const tag = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i)
  }
  tag(0, 'RIFF')
  header.setUint32(4, 36 + length, true)
  tag(8, 'WAVEfmt ')
  header.setUint32(16, 16, true)
  header.setUint16(20, 1, true)
  header.setUint16(22, format.channels, true)
  header.setUint32(24, format.sampleRate, true)
  header.setUint32(28, format.sampleRate * format.channels * 2, true)
  header.setUint16(32, format.channels * 2, true)
  header.setUint16(34, 16, true)
  tag(36, 'data')
  header.setUint32(40, length, true)
}

function createWhisperSTT(options: { apiKey: string; model?: string; language?: string; maxAudioBytes?: number }): STT {
  const whisper = new Whisper(options)
  const limit = options.maxAudioBytes ?? 192000
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new RangeError('invalid speech buffer size')
  return {
    async open({ signal, format, onTranscript, utteranceId }) {
      requireActive(signal)
      // 録音PCMで固定容量のXS chunk領域を使い切らず、HTTPや応答解析の領域を残す
      let recording: Uint8Array = new Uint8Array(new SharedArrayBuffer(44 + limit))
      const scope = createVoiceScope(signal)
      let used = 44,
        ended = false
      return {
        input: createPcmSink(format, (bytes) => {
          requireActive(scope.signal)
          if (ended || used + bytes.length > recording.length) throw voiceError('input_overrun')
          recording.set(bytes, used)
          used += bytes.length
        }),
        async finish() {
          if (ended) return
          ended = true
          requireActive(scope.signal)
          if (used === 44) {
            onTranscript({ utteranceId, text: '', final: true })
            return
          }
          waveHeader(recording, format, used - 44)
          const result = await whisper.transcribe(recording.subarray(0, used), scope.signal)
          requireActive(scope.signal)
          if (result.success === false) throw voiceError('provider_failed', result.reason)
          onTranscript({ utteranceId, text: result.value, final: true })
        },
        async close() {
          scope.abort()
          recording = new Uint8Array(0)
        },
      }
    },
  }
}

function streamSpeech(
  apiKey: string,
  body: ArrayBuffer,
  signal: VoiceSignal,
  consume: (bytes: Uint8Array) => void | Promise<void>,
) {
  return new Promise<void>((resolve, reject) => {
    let client: Pick<HTTPClient, 'request' | 'close'>,
      timer: ReturnType<typeof Timer.set>,
      offset = 0,
      closed = false
    const receiver = createPcmBodyReader(consume, finish)
    function finish(error?: unknown) {
      if (closed) return
      closed = true
      receiver.close()
      signal.removeEventListener('abort', abort)
      if (timer !== undefined) Timer.clear(timer)
      client?.close()
      if (error) reject(error)
      else resolve()
    }
    const abort = () => finish(signal.reason ?? voiceError('cancelled'))
    try {
      requireActive(signal)
      signal.addEventListener('abort', abort)
      timer = Timer.set(() => finish(voiceError('deadline_exceeded')), 45000)
      client = createClosingClient(device.network.https.client.io, {
        ...device.network.https.client,
        host: 'api.openai.com',
        port: 443,
        onError: (error) => finish(error ?? voiceError('provider_failed')),
      })
      client.request({
        method: 'POST',
        path: '/v1/audio/speech',
        headers: new Headers([
          ['Authorization', `Bearer ${apiKey}`],
          ['Content-Type', 'application/json'],
          ['Content-Length', String(body.byteLength)],
        ]),
        onHeaders(status) {
          if (status !== 200) finish(voiceError('provider_failed', `speech HTTP ${status}`))
        },
        onWritable(count) {
          if (closed) return
          const size = Math.min(count, body.byteLength - offset)
          if (size > 0) {
            this.write(new DataView(body, offset, size))
            offset += size
          }
        },
        onReadable(count) {
          receiver.ready(this, count)
        },
        onDone(error) {
          receiver.done(error)
        },
      })
    } catch (error) {
      finish(error)
    }
  })
}

function createOpenAISpeechTTS(options: { apiKey: string; model?: string }): TTS {
  return {
    capabilities: { input: 'segmented', output: 'streaming' },
    async open({ signal, format, voice }) {
      requireActive(signal)
      if (format.sampleRate !== 24000 || format.channels !== 1)
        throw voiceError('unsupported_capability', 'OpenAI PCM uses 24 kHz mono')
      const scope = createVoiceScope(signal),
        source = createPcmSource(format)
      let text = '',
        sealed = false
      let active: Promise<void> | undefined
      let ending: Promise<void> | undefined
      let failure: unknown
      const abort = () => {
        sealed = true
        text = ''
        source.end(scope.signal.reason ?? voiceError('cancelled'))
      }
      scope.signal.addEventListener('abort', abort)
      function requireWritable() {
        requireActive(scope.signal)
        if (failure) throw failure
        if (sealed) throw voiceError('cancelled', 'speech input has ended')
      }
      function synthesize() {
        requireActive(scope.signal)
        if (failure) throw failure
        if (active) throw voiceError('device_busy', 'await the previous speech flush')
        if (!text) return Promise.resolve()
        const segment = text
        text = ''
        const body = ArrayBuffer.fromString(
          JSON.stringify({ model: options.model ?? 'tts-1', voice, input: segment, response_format: 'pcm' }),
        )
        active = streamSpeech(options.apiKey, body, scope.signal, source.offer).then(
          () => {
            active = undefined
          },
          (error) => {
            active = undefined
            failure = error
            text = ''
            source.end(error)
            throw error
          },
        )
        return active
      }
      return {
        output: source.output,
        async write(part) {
          requireWritable()
          if (text.length + part.length > 4096) throw voiceError('resource_exhausted', 'speech text too long')
          text += part
        },
        async flush() {
          requireWritable()
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
        },
      }
    },
  }
}

export const WhisperSTT = { create: createWhisperSTT }
export const OpenAISpeechTTS = { create: createOpenAISpeechTTS }
