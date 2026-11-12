import type { VoiceSignal } from '../contracts.js'

export const transcription = {
  run: (_audio: Uint8Array, _signal: VoiceSignal): Promise<{ success: true; value: string }> => {
    throw new Error('transcription handler is not installed')
  },
}

export default class Whisper {
  // biome-ignore lint/complexity/noUselessConstructor: 実装と同じコンストラクター引数を型検査する
  constructor(_options: { apiKey: string; model?: string; language?: string }) {}
  transcribe(
    audio: Uint8Array,
    signal: VoiceSignal,
  ): Promise<{ success: true; value: string } | { success: false; reason: string }> {
    return transcription.run(audio, signal)
  }
}
