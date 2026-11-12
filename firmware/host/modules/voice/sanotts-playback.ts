import type { SpeakerSpeechPlayback, SpeechPlaybackListener } from 'speech-playback-types'
import type { Speaker } from 'stackchan/voice/contracts'
import { playSpeech } from 'stackchan/voice/play-speech'
import { createSanoTTS } from 'stackchan/voice/sanotts'
import { voiceError } from 'stackchan/voice/scope'

export class SpeechPlayback implements SpeakerSpeechPlayback {
  readonly #tts = createSanoTTS()
  readonly #volume: number
  constructor(options: { volume?: number } = {}) {
    this.#volume = options.volume ?? 0.1
  }
  playUtterance(
    speaker: Speaker,
    kind: 'text' | 'koe',
    text: string,
    volume: number | undefined,
    onPlayed: SpeechPlaybackListener,
  ) {
    if (kind === 'koe') throw voiceError('unsupported_capability', 'sanoTTS does not support singing')
    return playSpeech(speaker, this.#tts.open, text, volume ?? this.#volume, onPlayed)
  }
}
