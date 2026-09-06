import type { BorrowedAudioBuffer } from 'audio-buffer'
import type { AudioOutputPort } from 'audio-ports'
import { finiteNumber, StackchanError } from 'stackchan/errors'
import {
  DEFAULT_PLAYBACK_VOLUME,
  MAX_PLAYBACK_BYTES,
  MAX_PLAYBACK_DURATION_MS,
  MAX_TONE_DURATION_MS,
  MAX_TONE_HZ,
  MIN_TONE_HZ,
} from 'stackchan-contracts/audio-playback'
import { beginPlaybackSession, PlaybackProvider, type PlaybackSession } from 'tts-playback-session'
import { getWasmAudioOutputBridge, playWasmAudio, wasmAudioOutputAvailable } from 'wasm-audio-playback'

export default class Speaker extends PlaybackProvider implements AudioOutputPort {
  readonly volume: number

  constructor(options: { volume?: number } = {}) {
    super()
    this.volume = options.volume ?? DEFAULT_PLAYBACK_VOLUME
    finiteNumber(this.volume, 'volume', 0, 1)
  }

  available(): boolean {
    return wasmAudioOutputAvailable()
  }

  tone(hz: number, duration: number, volume = this.volume): Promise<void> {
    return this.#play((session) => {
      finiteNumber(hz, 'hz', MIN_TONE_HZ, MAX_TONE_HZ)
      finiteNumber(duration, 'durationMs', 0, MAX_TONE_DURATION_MS)
      finiteNumber(volume, 'volume', 0, 1)
      const bridge = getWasmAudioOutputBridge()
      playWasmAudio(session, bridge, () => bridge.startTone(hz, duration, volume), duration)
    })
  }

  play(buffer: BorrowedAudioBuffer, volume = this.volume): Promise<boolean> {
    return this.#play((session) => {
      finiteNumber(volume, 'volume', 0, 1)
      if (!(buffer instanceof ArrayBuffer) || !buffer.byteLength || buffer.byteLength > MAX_PLAYBACK_BYTES)
        throw new StackchanError('INVALID_ARGUMENT', 'Audio buffer is empty or exceeds playback limits')
      const bridge = getWasmAudioOutputBridge()
      playWasmAudio(session, bridge, () => bridge.startPlayBuffer(buffer, volume), MAX_PLAYBACK_DURATION_MS)
    }).then(() => true)
  }

  #play(start: (session: PlaybackSession) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const session = beginPlaybackSession(this, (error) => {
        if (error !== undefined) reject(error)
        else resolve()
      })
      if (!session) return
      try {
        start(session)
      } catch (error) {
        session.fail(error)
      }
    })
  }
}
