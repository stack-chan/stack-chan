import type { UtterancePlayback } from 'speech-playback-types'
import type { AudioLevel, Speaker, TTS } from 'stackchan/voice/contracts'
import { mono } from 'stackchan/voice/media'
import { createVoiceScope, requireActive, voiceError } from 'stackchan/voice/scope'

const budget = { maxBufferedMs: 250, maxBufferedBytes: 24576 }

export function playSpeech(
  speaker: Speaker,
  open: TTS['open'],
  text: string,
  volume: number,
  onLevel: (level: AudioLevel) => void,
): UtterancePlayback {
  const scope = createVoiceScope()
  let cleanupFailure: { error: unknown } | undefined
  async function release(resource: { close(): Promise<void> }) {
    try {
      await resource.close()
    } catch (error) {
      cleanupFailure = { error }
      throw error
    }
  }
  async function play() {
    const lease = await speaker.runtime.acquirePlayback(speaker, [mono(24000)], { ...scope, budget, onLevel })
    try {
      requireActive(scope.signal)
      lease.setVolume(volume)
      const synthesis = await open({ signal: scope.signal, format: lease.output.format, voice: 'default' })
      try {
        requireActive(scope.signal)
        const sink = lease.output.begin('utterance', 0)
        const link = await lease.media.connect(synthesis.output, sink, { signal: scope.signal, budget })
        try {
          await synthesis.write(text)
          await synthesis.endInput()
          await link.done
          const receipt = await lease.output.finish('utterance')
          if (receipt.state !== 'played') throw voiceError(receipt.state === 'failed' ? 'playback_failed' : 'cancelled')
        } finally {
          await release(link)
        }
      } finally {
        await release(synthesis)
      }
    } finally {
      await release(lease)
    }
  }
  const done = play()
  return {
    done,
    async close() {
      scope.abort()
      await done.catch(() => {})
      if (cleanupFailure) throw cleanupFailure.error
    },
  }
}
