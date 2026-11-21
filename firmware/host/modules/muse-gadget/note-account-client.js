import MuseAccountNative from 'muse-account-native'
import { createAudioNoteBody } from 'muse-audio-note'
import { MuseChatSession } from 'muse-chat-session'
import { createMuseNoteConversation } from 'muse-note-conversation'
import playReply from 'muse-note-tts'
import RNG from 'rng'
import { museSessionId } from 'muse-session-id'
import { createPcmSink } from 'stackchan/voice/media'
import { createVoiceScope } from 'stackchan/voice/scope'
import TextDecoder from 'text/decoder'
import TextEncoder from 'text/encoder'
import Time from 'time'
import Timer from 'timer'

export function createMuseAccountNoteConversation(account, { nodeId, onDiagnostic, onUploadMetrics, onPlaybackMetrics, onPlaybackState } = {}) {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const id = museSessionId(new Uint8Array(RNG.get(16)))
  let elapsed = 0
  let previous = Time.ticks
  return createMuseNoteConversation({
    createPcmSink,
    onDiagnostic,
    createScope: createVoiceScope,
    playReply: (message, context) => playReply(message, { ...context, onMetrics: onPlaybackMetrics, onPlaybackState }),
    async openBackend({ signal }) {
      const options = { nodeId, sessionId: id }
      const chat = new MuseChatSession(options, {
        onDiagnostic,
        onUploadMetrics,
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
      })
      const abort = () => chat.close()
      signal.addEventListener('abort', abort)
      try {
        if (signal.aborted) throw new Error('cancelled')
        await chat.connect()
        onDiagnostic?.('note_chat_ready')
      } catch (error) {
        signal.removeEventListener('abort', abort)
        chat.close()
        throw error
      }
      return {
        id: options.sessionId,
        async sendNote(pcm, { signal }) {
          onDiagnostic?.('note_upload_start')
          const result = await chat.sendBody(createAudioNoteBody(pcm, { ...options, outputModality: 'voice' }, { encodeBase64: (bytes) => bytes.toBase64() }), {
            signal,
          })
          onDiagnostic?.('note_reply_complete')
          return result
        },
        readTts(messageId, options) {
          return chat.readTts(messageId, options)
        },
        close() {
          signal.removeEventListener('abort', abort)
          chat.close()
        },
      }
    },
  })
}
