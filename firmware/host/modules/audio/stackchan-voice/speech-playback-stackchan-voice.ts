import type { SpeakerSpeechPlayback, SpeechPlaybackListener } from 'speech-playback-types'
import type { Speaker } from 'stackchan/voice/contracts'
import { playSpeech } from 'stackchan/voice/play-speech'
import { createStackchanVoiceTTS } from 'stackchan/voice/stackchan-voice'

type Options = { speed?: number; voice?: string; volume?: number }

export class SpeechPlayback implements SpeakerSpeechPlayback {
  readonly #tts: ReturnType<typeof createStackchanVoiceTTS>
  readonly #volume: number

  constructor(options: Options = {}) {
    // The native engine read saved speeds as uint16_t and used 100 for zero.
    const speed = (options.speed ?? 100) & 0xffff || 100
    this.#tts = createStackchanVoiceTTS({ speed, voice: options.voice === 'cute' ? 'cute' : 'normal' })
    this.#volume = options.volume ?? 0.1
  }

  playUtterance(
    speaker: Speaker,
    kind: 'text' | 'koe',
    text: string,
    volume: number | undefined,
    onPlayed: SpeechPlaybackListener,
  ) {
    const open = kind === 'koe' ? this.#tts.openKoe : this.#tts.open
    return playSpeech(speaker, open, text, volume ?? this.#volume, onPlayed)
  }
}
