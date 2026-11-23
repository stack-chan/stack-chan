import MuseAccountNative from 'muse-account-native'
import { createMuseCascadedConversation } from 'muse-cascaded-conversation'
import { createMuseChatAgent } from 'muse-chat-agent'
import { MuseChatSession } from 'muse-chat-session'
import { museSessionId } from 'muse-session-id'
import { createProfiledSpeech } from 'muse-speech-profile'
import { createProfiledGeminiSpeech } from 'muse-speech-provider'
import Preference from 'preference'
import RNG from 'rng'
import { createCascadedConversation, createPushToTalk } from 'stackchan/voice/cascaded'
import { GeminiSpeechTTS, GeminiTranscribeSTT } from 'stackchan/voice/gemini-speech'
import { OpenAISpeechTTS, WhisperSTT } from 'stackchan/voice/speech'
import { createResponseTransport } from 'stackchan-ai-http'
import TextDecoder from 'text/decoder'
import TextEncoder from 'text/encoder'
import Time from 'time'
import Timer from 'timer'

export function hasOpenAISpeechKey() {
  const value = Preference.get('ai', 'token')
  return typeof value === 'string' && value.trim().length > 0
}

export function hasGeminiSpeechKey() {
  const value = Preference.get('ai', 'geminiToken')
  return typeof value === 'string' && value.trim().length > 0
}

export function createMuseAccountCascadedConversation(
  account,
  { nodeId, onDiagnostic, onPlaybackState, getSpeechVoice, getSpeechProvider, getGeminiVoice } = {},
) {
  const provider = getSpeechProvider?.() ?? 'openai'
  if (provider !== 'openai' && provider !== 'gemini') throw new Error('unsupported speech provider')
  const apiKey = Preference.get('ai', provider === 'gemini' ? 'geminiToken' : 'token')
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    const code = provider === 'gemini' ? 'gemini_key_missing' : 'openai_key_missing'
    onDiagnostic?.(code)
    throw Object.assign(new Error('Speech API key is not configured'), { code })
  }
  const request =
    provider === 'gemini'
      ? createResponseTransport('https://generativelanguage.googleapis.com/v1beta/interactions', '', 45000, 16384, {
          'x-goog-api-key': apiKey,
        })
      : undefined
  const stt = request
    ? GeminiTranscribeSTT.create({ request, maxAudioBytes: 480000 })
    : WhisperSTT.create({ apiKey, language: 'ja', maxAudioBytes: 480000 })
  const speechRequest = request
    ? createResponseTransport(
        'https://generativelanguage.googleapis.com/v1beta/interactions',
        '',
        45000,
        16384,
        {
          'x-goog-api-key': apiKey,
        },
        true,
      )
    : undefined
  const tts = request
    ? createProfiledGeminiSpeech(
        (options) =>
          GeminiSpeechTTS.create({
            request: speechRequest,
            ...options,
            onMetrics: ({ maxEventChars, pcmBytes }) => onDiagnostic?.(`tts_metrics_${maxEventChars}_${pcmBytes}`),
          }),
        getGeminiVoice,
      )
    : createProfiledSpeech((options) => OpenAISpeechTTS.create({ apiKey, ...options }), getSpeechVoice)
  return createMuseCascadedConversation({
    createConversation: createCascadedConversation,
    createPushToTalk,
    createAgent: createMuseChatAgent,
    stt,
    tts,
    voice: provider === 'gemini' ? 'Leda' : 'marin',
    onPlaybackState,
    async openChat({ signal }) {
      const encoder = new TextEncoder(),
        decoder = new TextDecoder()
      let elapsed = 0,
        previous = Time.ticks
      const chat = new MuseChatSession(
        { nodeId, sessionId: museSessionId(new Uint8Array(RNG.get(16))) },
        {
          onDiagnostic,
          open: (_options, callback) => new MuseAccountNative(account, callback, 'hatch-web'),
          encode: (value) => encoder.encode(value).buffer,
          decode: (value) => decoder.decode(value),
          setTimer: (callback, delay) => Timer.set(callback, delay),
          clearTimer: (handle) => Timer.clear(handle),
          now() {
            const next = Time.ticks
            elapsed += (next - previous) >>> 0
            previous = next
            return elapsed
          },
        },
      )
      const abort = () => chat.close()
      signal.addEventListener('abort', abort)
      try {
        if (signal.aborted) throw new Error('cancelled')
        await chat.connect()
        onDiagnostic?.('cascaded_chat_ready')
      } catch (error) {
        signal.removeEventListener('abort', abort)
        chat.close()
        throw error
      }
      return {
        send: (message, scope) => chat.send(message, scope),
        close() {
          signal.removeEventListener('abort', abort)
          chat.close()
        },
      }
    },
  })
}
