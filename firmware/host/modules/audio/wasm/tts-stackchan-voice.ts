declare const setTimeout: (callback: () => void, delay?: number) => unknown

import Resource from 'Resource'
import { renderStackchanVoiceWav } from 'stackchan-voice-wav'
import StackchanVoice from 'stackchanvoice'
import type { TTSCompletion, TTSDoneListener, TTSPlaybackListener } from 'tts-types'
import type { WasmAudioOutputBridge } from './audio-bridge-contract.js'

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

function schedule(audioBridge: WasmAudioOutputBridge, callback: () => void, delay: number): void {
  if (audioBridge.setTimer) audioBridge.setTimer(callback, delay)
  else setTimeout(callback, delay)
}

export class TTS {
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
  streaming = false
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
    if (this.streaming) {
      callback?.(new Error('already playing'))
      return
    }
    this.streaming = true

    const finish = (error?: unknown): void => {
      if (!this.streaming) return
      this.streaming = false
      try {
        this.onDone?.()
      } finally {
        callback?.(error)
      }
    }

    const audioBridge = getAudioBridge()
    void renderStackchanVoiceWav(this.voice, text, {
      schedule: (callback) => schedule(audioBridge, callback, 0),
      speed: this.speed,
      volume: volume ?? this.volume,
    }).then(
      (rendered) => {
        if (!this.streaming) return
        if (rendered.samples === 0) {
          finish()
          return
        }

        try {
          audioBridge.startPlayBuffer(rendered.buffer)
          this.onPlayed?.(rendered.power)

          const poll = () => {
            if (!this.streaming) return
            const status = audioBridge.playStatus()
            if (status === 0) {
              schedule(audioBridge, poll, WASM_AUDIO_BRIDGE_POLL_INTERVAL_MS)
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
