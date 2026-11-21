import MuseNative from 'muse-native'
import { createMuseVoiceBridge } from 'muse-voice-bridge'
import { createMuseConversation } from 'muse-voice-conversation'
import MuseVoiceCore from 'muse-voice-core'
import RNG from 'rng'
import { createPcmSink, createPcmSource } from 'stackchan/voice/media'
import TextDecoder from 'text/decoder'
import TextEncoder from 'text/encoder'
import Time from 'time'
import Timer from 'timer'

function callId() {
  const bytes = new Uint8Array(RNG.get(16))
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  let id = ''
  for (let i = 0; i < bytes.length; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) id += '-'
    id += bytes[i].toString(16).padStart(2, '0')
  }
  return id
}
export function createMuseVoiceConversation(configuration) {
  return createMuseVoiceConversationWithNative(configuration, (options, callback) => new MuseNative(options, callback))
}
export function createMuseVoiceConversationWithNative(configuration, openNative, onDiagnostic) {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  let elapsed = 0
  let previous = Time.ticks
  return createMuseConversation(
    createMuseVoiceBridge(configuration, {
      createCore: () => new MuseVoiceCore(),
      openNative,
      onDiagnostic,
      createPcmSource,
      createPcmSink,
      encode: (value) => encoder.encode(value).buffer,
      decode: (value) => decoder.decode(value),
      nowUs() {
        const next = Time.ticks
        elapsed += (next - previous) >>> 0
        previous = next
        return elapsed * 1000
      },
      wallMs: () => Date.now(),
      callId,
      setTimer: (callback, delay) => Timer.set(callback, delay),
      clearTimer: (handle) => Timer.clear(handle),
    }),
  )
}
