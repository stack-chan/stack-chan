declare const setTimeout: (callback: () => void, delay?: number) => unknown

import type { OwnedAudioBuffer } from 'audio-buffer'
import { ownAudioBuffer } from 'audio-buffer'
import type { WasmAudioInputBridge } from './audio-bridge-contract.js'

const WASM_AUDIO_BRIDGE_POLL_INTERVAL_MS = 50

type AudioBridgeGlobal = typeof globalThis & {
  __stackchanWasmAudioBridge?: WasmAudioInputBridge
  Host?: {
    AudioIn?: {
      close?: () => void
      record?: (durationMilliSec: number) => Promise<ArrayBuffer> | ArrayBuffer
    }
  }
}

const getAudioBridge = (): WasmAudioInputBridge => {
  const env = globalThis as AudioBridgeGlobal
  let recorded = new ArrayBuffer(0)
  let recordError: string | undefined
  let status = -1
  return (
    env.__stackchanWasmAudioBridge ?? {
      close: () => env.Host?.AudioIn?.close?.(),
      recordError: () => recordError,
      recordBuffer: () => recorded,
      recordStatus: () => status,
      startRecord: (duration) => {
        status = 0
        recordError = undefined
        Promise.resolve(env.Host?.AudioIn?.record?.(duration) ?? new ArrayBuffer(0)).then(
          (buffer) => {
            recorded = buffer
            status = 1
          },
          (error) => {
            recordError = error instanceof Error ? error.message : String(error)
            status = -1
          },
        )
      },
    }
  )
}

const schedule = (audioBridge: WasmAudioInputBridge, callback: () => void, delay: number) => {
  if (audioBridge.setTimer) audioBridge.setTimer(callback, delay)
  else setTimeout(callback, delay)
}

export default class Microphone {
  constructor(_options?: unknown) {
    void _options
  }

  async record(durationMilliSec = 3000): Promise<OwnedAudioBuffer> {
    const audioBridge = getAudioBridge()
    audioBridge.startRecord(durationMilliSec)
    return new Promise((resolve, reject) => {
      const poll = () => {
        const status = audioBridge.recordStatus()
        if (status === 0) {
          schedule(audioBridge, poll, WASM_AUDIO_BRIDGE_POLL_INTERVAL_MS)
          return
        }
        if (status > 0) {
          resolve(ownAudioBuffer(audioBridge.recordBuffer()))
        } else {
          reject(new Error(audioBridge.recordError?.() ?? 'audio recording failed'))
        }
      }
      poll()
    })
  }

  close() {
    getAudioBridge().close()
  }
}
