import Headers from 'headers'
import type { VoiceSignal } from 'stackchan/voice/contracts'
import { requireActive } from 'stackchan/voice/scope'
import { equal } from 'testing/assert'

function responseBody() {
  // Whisperアダプターが許容する32KiB以内の応答を、録音を保持したまま解析する
  const text = 'x'.repeat(30 * 1024)
  return ArrayBuffer.fromString(`{"text":"${text}"}`)
}

export default class Whisper {
  // biome-ignore lint/complexity/noUselessConstructor: 実際のWhisperと同じコンストラクター型で差し替える
  constructor(_options: { apiKey: string; model?: string; language?: string }) {}

  async transcribe(
    audio: Uint8Array,
    signal: VoiceSignal,
  ): Promise<{ success: true; value: string } | { success: false; reason: string }> {
    requireActive(signal)
    equal(audio.byteLength, 194560 + 44)
    const header = new DataView(audio.buffer, audio.byteOffset, 44)
    equal(header.getUint32(24, true), 16000)
    equal(header.getUint32(40, true), 194560)
    for (let offset = 44; offset < audio.length; offset++) equal(audio[offset], (offset - 44) & 255)
    const headers = new Headers([['content-type', 'application/json']])
    const body = responseBody()
    equal(headers.get('content-type'), 'application/json')
    const parsed = JSON.parse(String.fromArrayBuffer(body))
    equal(parsed.text.length, 30 * 1024)
    equal(parsed.text[0], 'x')
    equal(parsed.text[parsed.text.length - 1], 'x')
    equal(body.byteLength < 32 * 1024, true)
    return { success: true as const, value: 'recognized' }
  }
}
