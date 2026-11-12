import type { SpeechPlaybackListener } from 'speech-playback-types'
import type { Speaker, TTS } from 'stackchan/voice/contracts'
import { mono } from 'stackchan/voice/media'
import { createVoiceScope, requireActive, voiceError } from 'stackchan/voice/scope'

const budget = { maxBufferedMs: 250, maxBufferedBytes: 24576 }

export function playSpeech(
  speaker: Speaker,
  open: TTS['open'],
  text: string,
  volume: number,
  onPlayed: SpeechPlaybackListener,
) {
  const scope = createVoiceScope()
  const play = async () => {
    const lease = await speaker.runtime.acquirePlayback(speaker, [mono(24000)], { ...scope, budget, onPlayed })
    try {
      requireActive(scope.signal)
      lease.setVolume(volume)
      const options = { signal: scope.signal, format: lease.output.format, voice: 'default' }
      const synthesis = await open(options)
      try {
        requireActive(scope.signal)
        const sink = lease.output.begin('utterance', 0)
        const link = await lease.media.connect(synthesis.output, sink, { signal: scope.signal, budget })
        try {
          await synthesis.write(text)
          await synthesis.finish()
          await link.done
          const receipt = await lease.output.finish('utterance')
          if (receipt.state !== 'played') throw voiceError(receipt.state === 'failed' ? 'playback_failed' : 'cancelled')
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
