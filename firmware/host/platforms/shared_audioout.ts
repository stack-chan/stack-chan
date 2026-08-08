import PhysicalAudioOut from 'embedded:io/audio/out-original'
import { createSharedAudioOutClass } from 'shared-audio-out'

const SharedAudioOutBase = createSharedAudioOutClass(PhysicalAudioOut, {
  onFormat: ({ sampleRate }) => {
    const amp = (globalThis as typeof globalThis & { amp?: { sampleRate: number } }).amp
    if (amp) amp.sampleRate = sampleRate
  },
})

export default class SharedAudioOut extends SharedAudioOutBase {}
