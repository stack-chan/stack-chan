import MuseAccountNative from 'muse-account-native'
import { createMuseCascadedConversation } from 'muse-cascaded-conversation'
import { createMuseChatAgent } from 'muse-chat-agent'
import { MuseChatSession } from 'muse-chat-session'
import { museSessionId } from 'muse-session-id'
import RNG from 'rng'
import { createCascadedConversation, createPushToTalk } from 'stackchan/voice/cascaded'
import { GeminiTranscribeSTT } from 'stackchan/voice/gemini-speech'
import { GeminiSpeechTTS } from 'stackchan/voice/gemini-worker-tts'
import { createResponseTransport } from 'stackchan-ai-http'
import TextDecoder from 'text/decoder'
import TextEncoder from 'text/encoder'
import Time from 'time'
import Timer from 'timer'

const endpoint = 'https://generativelanguage.googleapis.com/v1beta/interactions'

export function createHostMuseConversation(account, nodeId, apiKey, onDiagnostic) {
  const request = createResponseTransport(endpoint, '', 45000, 16384, { 'x-goog-api-key': apiKey })
  const stt = GeminiTranscribeSTT.create({
    request,
    maxAudioBytes: 480000,
    timing: { now: () => Time.ticks, emit: (values) => onDiagnostic('stt', values) },
  })
  const tts = GeminiSpeechTTS.create({
    endpoint,
    apiKey,
    nativeTransport: true,
    sampleRate: 24000,
    timeoutMs: 120000,
    transportTimeoutMs: 120000,
    pcmIdleTimeoutMs: 45000,
    onLifecycle: (phase) => onDiagnostic('tts', [phase]),
    onFailure: (reason) => onDiagnostic('tts_failure', [reason]),
    onMetrics: ({ pcmBytes }) => onDiagnostic('tts_pcm', [pcmBytes]),
  })
  return createMuseCascadedConversation({
    buffered: true,
    createConversation: (config) => createCascadedConversation(config, 'buffered'),
    createPushToTalk,
    createAgent: createMuseChatAgent,
    stt,
    tts,
    voice: 'Leda',
    async openChat({ signal }) {
      const encoder = new TextEncoder()
      const decoder = new TextDecoder()
      let elapsed = 0
      let previous = Time.ticks
      const chat = new MuseChatSession(
        { nodeId, sessionId: museSessionId(new Uint8Array(RNG.get(16))) },
        {
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
