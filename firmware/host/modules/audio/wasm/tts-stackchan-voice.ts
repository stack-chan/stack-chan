import Resource from 'Resource'
import { renderStackchanVoiceKoeWav, renderStackchanVoiceWav } from 'stackchan-voice-wav'
import StackchanVoice from 'stackchanvoice'
import { beginPlaybackSession } from 'tts-playback-session'
import type { TTSCompletion, TTSDoneListener, TTSPlaybackListener } from 'tts-types'
import { scheduleWasmAudioTimer, type WasmAudioOutputBridge } from 'wasm-audio-bridge-contract'

const WASM_AUDIO_BRIDGE_POLL_INTERVAL_MS = 50

export type TTSProperty = {
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
  volume?: number
  speed?: number
  voice?: 'normal' | 'cute'
}

type AudioBridgeGlobal = typeof globalThis & {
  __stackchanWasmAudioBridge?: WasmAudioOutputBridge
  Host?: {
    AudioOut?: {
      close?: () => void
      play?: (buffer: ArrayBuffer) => Promise<boolean> | boolean
    }
  }
}

function getAudioBridge(): WasmAudioOutputBridge {
  const env = globalThis as AudioBridgeGlobal
  let playStatus = -1
  return (
    env.__stackchanWasmAudioBridge ?? {
      close: () => env.Host?.AudioOut?.close?.(),
      playStatus: () => playStatus,
      startPlayBuffer: (buffer) => {
        playStatus = 0
        Promise.resolve(env.Host?.AudioOut?.play?.(buffer) ?? false).then(
          (played) => {
            playStatus = played ? 1 : -1
          },
          () => {
            playStatus = -1
          },
        )
      },
      tone: () => {},
    }
  )
}

export class TTS {
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
  streaming = false
  cancelPlayback?: (reason?: unknown) => void
  readonly volume: number
  readonly speed: number
  readonly voice: StackchanVoice

  constructor(props: TTSProperty = {}) {
    this.onPlayed = props.onPlayed
    this.onDone = props.onDone
    this.volume = props.volume ?? 0.5
    this.speed = props.speed ?? 100
    const preset = props.voice === 'cute' ? StackchanVoice.Cute : StackchanVoice.Normal
    this.voice = new StackchanVoice(preset, new Resource('stackchan-ja.aqd'))
  }

  stream(text: string, volume?: number, callback?: TTSCompletion): void {
    this.#stream(text, false, volume, callback)
  }

  streamKoe(koe: string, volume?: number, callback?: TTSCompletion): void {
    this.#stream(koe, true, volume, callback)
  }

  #stream(source: string, isKoe: boolean, volume?: number, callback?: TTSCompletion): void {
    const session = beginPlaybackSession(this, callback)
    if (!session) return
    const audioBridge = getAudioBridge()
    let playing = false
    session.addCleanup(() => {
      if (playing) audioBridge.close()
    })
    let renderTick: (() => void) | undefined
    let cancelRenderTimer: (() => void) | undefined
    let cancelPollTimer: (() => void) | undefined
    session.addCleanup(() => {
      cancelPollTimer?.()
      cancelRenderTimer?.()
      // Settle the renderer too, without reading or resetting the shared voice.
      const cancelledTick = renderTick
      renderTick = undefined
      cancelledTick?.()
    })
    const finish = (error?: unknown) => (error === undefined ? session.onDone() : session.fail(error))
    const render = isKoe ? renderStackchanVoiceKoeWav : renderStackchanVoiceWav
    void render(this.voice, source, {
      schedule: (callback) => {
        renderTick = callback
        cancelRenderTimer = scheduleWasmAudioTimer(
          audioBridge,
          () => {
            renderTick = undefined
            callback()
          },
          0,
        )
      },
      isCancelled: () => session.closed,
      speed: this.speed,
      volume: volume ?? this.volume,
    }).then(
      (rendered) => {
        if (session.closed) return
        if (rendered.samples === 0) {
          finish()
          return
        }

        try {
          playing = true
          audioBridge.startPlayBuffer(rendered.buffer)
          this.onPlayed?.(rendered.power)

          const poll = () => {
            if (session.closed) return
            const status = audioBridge.playStatus()
            if (status === 0) {
              cancelPollTimer = scheduleWasmAudioTimer(audioBridge, poll, WASM_AUDIO_BRIDGE_POLL_INTERVAL_MS)
            } else if (status > 0) {
              finish()
            } else {
              finish(new Error('stackchan-voice browser playback failed'))
            }
          }
          poll()
        } catch (error) {
          finish(error)
        }
      },
      (error) => finish(error),
    )
  }
}
