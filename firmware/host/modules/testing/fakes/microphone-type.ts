import type { OwnedAudioBuffer } from 'audio-buffer'

export default class Microphone {
  record(_durationMilliSec?: number): Promise<OwnedAudioBuffer> {
    throw new Error('microphone fake is type-only')
  }
}
