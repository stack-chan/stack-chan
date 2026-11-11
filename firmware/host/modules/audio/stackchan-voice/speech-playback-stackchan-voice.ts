import type { SpeakerSpeechPlayback, SpeechPlaybackListener } from 'speech-playback-types'
import type { Speaker } from 'stackchan/voice/contracts'
import { mono } from 'stackchan/voice/media'
import { createVoiceScope, requireActive, voiceError } from 'stackchan/voice/scope'
import { createStackchanVoiceTTS } from 'stackchan/voice/stackchan-voice'

type Options = { speed?: number; voice?: string; volume?: number }

const budget = { maxBufferedMs: 250, maxBufferedBytes: 24576 }

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
    const scope = createVoiceScope()
    const play = async () => {
      const lease = await speaker.runtime.acquirePlayback(speaker, [mono(24000)], { ...scope, budget, onPlayed })
      try {
        requireActive(scope.signal)
        lease.setVolume(volume ?? this.#volume)
        const options = { signal: scope.signal, format: lease.output.format, voice: 'default' }
        const synthesis = kind === 'koe' ? await this.#tts.openKoe(options) : await this.#tts.open(options)
        try {
          requireActive(scope.signal)
          const sink = lease.output.begin('utterance', 0)
          const link = await lease.media.connect(synthesis.output, sink, { signal: scope.signal, budget })
          try {
            await synthesis.write(text)
            await synthesis.finish()
            await link.done
            const receipt = await lease.output.finish('utterance')
            if (receipt.state !== 'played')
              throw voiceError(receipt.state === 'failed' ? 'playback_failed' : 'cancelled')
          } finally {
            await link.close()
          }
        } finally {
          await synthesis.close()
        }
      } finally {
        await lease.close()
      }
    }
    return {
      done: play(),
      cancel() {
        scope.abort()
      },
    }
  }
}
