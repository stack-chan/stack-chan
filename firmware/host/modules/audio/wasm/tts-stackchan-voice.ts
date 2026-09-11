import Resource from 'Resource'
import { StackchanError } from 'stackchan/errors'
import {
  renderStackchanVoiceKoeWav,
  renderStackchanVoiceWav,
  STACKCHAN_VOICE_OUTPUT_SAMPLE_RATE,
} from 'stackchan-voice-wav'
import StackchanVoice from 'stackchanvoice'
import { beginPlaybackSession, PlaybackProvider } from 'tts-playback-session'
import type { TTSCompletion, TTSDoneListener, TTSPlaybackListener } from 'tts-types'
import { scheduleWasmAudioTimer } from 'wasm-audio-bridge-contract'
import { getWasmAudioOutputBridge, playWasmAudio, wasmAudioOutputAvailable } from 'wasm-audio-playback'

export type TTSProperty = {
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
  volume?: number
  speed?: number
  voice?: 'normal' | 'cute'
}

export class TTS extends PlaybackProvider {
  readonly volume: number
  readonly speed: number
  readonly voice: StackchanVoice

  constructor(props: TTSProperty = {}) {
    super(props)
    this.volume = props.volume ?? 0.5
    this.speed = props.speed ?? 100
    const preset = props.voice === 'cute' ? StackchanVoice.Cute : StackchanVoice.Normal
    this.voice = new StackchanVoice(preset, new Resource('stackchan-ja.aqd'))
  }

  stream(text: string, volume?: number, callback?: TTSCompletion): void {
    this.#stream(text, false, volume, callback)
  }

  available(): boolean {
    return wasmAudioOutputAvailable()
  }

  streamKoe(koe: string, volume?: number, callback?: TTSCompletion): void {
    this.#stream(koe, true, volume, callback)
  }

  #stream(source: string, isKoe: boolean, volume?: number, callback?: TTSCompletion): void {
    const session = beginPlaybackSession(this, callback)
    if (!session) return
    try {
      const bridge = getWasmAudioOutputBridge()
      let renderTick: (() => void) | undefined
      let cancelRenderTimer: (() => void) | undefined
      session.addCleanup(() => {
        try {
          cancelRenderTimer?.()
        } finally {
          // Settle the cancelled renderer without reading/resetting the voice.
          const cancelledTick = renderTick
          renderTick = undefined
          cancelledTick?.()
        }
      })
      const render = isKoe ? renderStackchanVoiceKoeWav : renderStackchanVoiceWav
      void session
        .waitFor(
          render(this.voice, source, {
            schedule: (callback) => {
              renderTick = callback
              cancelRenderTimer = scheduleWasmAudioTimer(
                bridge,
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
          }),
        )
        .then((rendered) => {
          if (session.closed) return
          if (rendered.samples === 0) {
            session.fail(new StackchanError('IO', 'Speech synthesis returned no audio'))
            return
          }
          playWasmAudio(
            session,
            bridge,
            () => bridge.startPlayBuffer(rendered.buffer),
            Math.ceil((rendered.samples * 1000) / STACKCHAN_VOICE_OUTPUT_SAMPLE_RATE),
          )
          session.onPower(rendered.power)
        }, session.fail)
    } catch (error) {
      session.fail(error)
    }
  }
}
