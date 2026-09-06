import type { BorrowedAudioBuffer } from 'audio-buffer'
import { beginPlaybackSession, PlaybackProvider, type PlaybackSession } from 'tts-playback-session'
import { scheduleWasmAudioTimer, type WasmAudioOutputBridge } from 'wasm-audio-bridge-contract'

const WASM_AUDIO_BRIDGE_POLL_INTERVAL_MS = 50

type AudioBridgeGlobal = typeof globalThis & {
  __stackchanWasmAudioBridge?: WasmAudioOutputBridge
  Host?: {
    AudioOut?: {
      close?: () => void
      play?: (buffer: ArrayBuffer) => Promise<boolean> | boolean
      tone?: (message: { hz: number; duration: number; volume?: number }) => Promise<void> | void
    }
  }
}

const getAudioBridge = (): WasmAudioOutputBridge => {
  const env = globalThis as AudioBridgeGlobal
  let playStatus = -1
  return (
    env.__stackchanWasmAudioBridge ?? {
      close: () => env.Host?.AudioOut?.close?.(),
      playStatus: () => playStatus,
      startPlayBuffer: (buffer) => {
        playStatus = 0
        Promise.resolve(env.Host?.AudioOut?.play?.(buffer) ?? false)
          .then((played) => {
            playStatus = played ? 1 : -1
          })
          .catch(() => {
            playStatus = -1
          })
      },
      tone: (hz, duration, volume) => {
        void env.Host?.AudioOut?.tone?.({ hz, duration, volume })
      },
    }
  )
}

export default class Speaker extends PlaybackProvider {
  constructor(_options?: unknown) {
    super()
    void _options
  }

  async tone(hz: number, duration: number, volume?: number): Promise<void> {
    const audioBridge = getAudioBridge()
    return this.#play(audioBridge, (session) => {
      audioBridge.tone(hz, duration, volume)
      session.addCleanup(scheduleWasmAudioTimer(audioBridge, session.onDone, duration + 250))
    })
  }

  async play(buffer: BorrowedAudioBuffer): Promise<boolean> {
    if (buffer.byteLength === 0) return false
    const audioBridge = getAudioBridge()
    await this.#play(audioBridge, (session) => {
      audioBridge.startPlayBuffer(buffer)
      let cancelTimer: (() => void) | undefined
      session.addCleanup(() => cancelTimer?.())
      const poll = () => {
        if (session.closed) return
        const status = audioBridge.playStatus()
        if (status === 0) {
          cancelTimer = scheduleWasmAudioTimer(audioBridge, poll, WASM_AUDIO_BRIDGE_POLL_INTERVAL_MS)
          return
        }
        if (status > 0) session.onDone()
        else session.fail(new Error('Browser audio playback failed'))
      }
      poll()
    })
    return true
  }

  #play(bridge: WasmAudioOutputBridge, start: (session: PlaybackSession) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const session = beginPlaybackSession(this, (error) => {
        if (error !== undefined) reject(error)
        else resolve()
      })
      if (!session) return
      session.addCleanup(() => bridge.close())
      try {
        start(session)
      } catch (error) {
        session.fail(error)
      }
    })
  }
}
