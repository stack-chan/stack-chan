import type { OwnedAudioBuffer } from 'audio-buffer'

export default class Microphone {
  recording = false

  start(): void {
    throw new Error('microphone fake is type-only')
  }

  stop(): void {
    throw new Error('microphone fake is type-only')
  }

  record(_durationMilliSec?: number): Promise<OwnedAudioBuffer> {
    throw new Error('microphone fake is type-only')
  }
}
