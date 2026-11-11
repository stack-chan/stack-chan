import { SpeechPlayback } from 'speech-playback-stackchan-voice'
import type { Speaker } from 'stackchan/voice/contracts'
import { createPcmSink, mono, pcmMedia } from 'stackchan/voice/media'
import { state } from 'stackchan-voice-test-state'
import { equal } from 'testing/assert'

async function run() {
  let bytes = 0
  let drains = 0
  let closes = 0
  let volume = 0
  let levels = 0
  const sink = createPcmSink(mono(24000), (block) => {
    bytes += block.length
  })
  const speaker: Speaker = {
    id: 'speaker',
    runtime: {
      async acquire() {
        throw Error('standalone playback requested a microphone')
      },
      async acquirePlayback(_speaker, formats, { budget, onPlayed }) {
        equal(formats[0].sampleRate, 24000)
        return {
          output: {
            ...sink,
            budget,
            begin: () => sink,
            async finish(outputId) {
              drains++
              onPlayed?.(1000)
              return { outputId, generation: 0, state: 'played', position: { basis: 'unknown' } }
            },
            async fence() {
              return []
            },
          },
          media: pcmMedia,
          setVolume(value) {
            volume = value
          },
          async close() {
            closes++
          },
        }
      },
    },
  }
  const player = new SpeechPlayback({ speed: 130, voice: 'cute', volume: 0.25 })
  const onPlayed = (value: number) => {
    levels += value
  }
  await player.playUtterance(speaker, 'text', 'デバイス再生', 0.75, onPlayed).done
  equal(volume, 0.75)
  await player.playUtterance(speaker, 'koe', '#C4,500ki', undefined, onPlayed).done
  equal(volume, 0.25)
  equal(state.says[0].text, 'デバイス再生')
  equal(state.koes[0].koe, '#C4,500ki')
  equal(state.koes[0].speed, 130)
  equal(bytes, 8, 'both two-frame utterances arrive without padding')
  equal(drains, 2)
  equal(closes, 2)
  equal(levels, 2000)
  equal(state.constructors[0].preset, 1)

  const savedVoice = new SpeechPlayback({ speed: 0, voice: 'alloy' })
  await savedVoice.playUtterance(speaker, 'text', 'こんにちは', undefined, onPlayed).done
  equal(state.constructors[1].preset, 0)
  equal(state.says[1].speed, 100)

  const emptyVoice = new SpeechPlayback({ speed: 65537.5, voice: '' })
  await emptyVoice.playUtterance(speaker, 'koe', 'ki', undefined, onPlayed).done
  equal(state.constructors[2].preset, 0)
  equal(state.koes[1].speed, 1)
}
run().then(
  () => trace('@@STACKCHAN_TEST:PASS@@\n'),
  (error) => {
    throw error
  },
)
