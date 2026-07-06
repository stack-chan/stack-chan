import type { BorrowedAudioBuffer } from 'audio-buffer'

export default class Speaker {
  tone(_hz: number, _duration: number, _volume?: number): Promise<void> {
    throw new Error('speaker fake is type-only')
  }

  play(_buffer: BorrowedAudioBuffer): Promise<boolean> {
    throw new Error('speaker fake is type-only')
  }
}
