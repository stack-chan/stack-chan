import type { StackchanErrorCode } from 'stackchan/errors'

export const WASM_AUDIO_BRIDGE_POLL_INTERVAL_MS = 50
declare const setTimeout: (callback: () => void, delay: number) => unknown
declare const clearTimeout: (handle: unknown) => void

export type WasmAudioBridge = {
  playAvailable: () => boolean
  playStatus: (id: number) => number
  playDetails: (id: number) => {
    quiet: boolean
    error?: { code: StackchanErrorCode; message: string }
    releaseError?: { code: StackchanErrorCode; message: string }
  }
  stopPlay: (id: number) => void
  releasePlay: (id: number) => void
  recordAvailable: () => boolean
  recordBuffer: (id: number) => ArrayBuffer
  recordDetails: (id: number) => {
    quiet: boolean
    mimeType: string
    filename: string
    error?: { code: StackchanErrorCode; message: string }
  }
  recordStatus: (id: number) => number
  setTimer?: (callback: () => void, delay?: number) => unknown
  clearTimer?: (handle: unknown) => void
  startPlayBuffer: (buffer: ArrayBuffer, volume?: number) => number
  startRecord: (duration: number) => number
  stopRecord: (id: number) => void
  releaseRecord: (id: number) => void
  startTone: (hz: number, duration: number, volume?: number) => number
}

export type WasmAudioInputBridge = Pick<
  WasmAudioBridge,
  | 'recordAvailable'
  | 'recordBuffer'
  | 'recordDetails'
  | 'recordStatus'
  | 'setTimer'
  | 'clearTimer'
  | 'startRecord'
  | 'stopRecord'
  | 'releaseRecord'
>

export type WasmAudioOutputBridge = Pick<
  WasmAudioBridge,
  | 'playAvailable'
  | 'playStatus'
  | 'playDetails'
  | 'stopPlay'
  | 'releasePlay'
  | 'setTimer'
  | 'clearTimer'
  | 'startPlayBuffer'
  | 'startTone'
>

export type WasmAudioBridgeGlobal = typeof globalThis & {
  __stackchanWasmAudioBridge?: WasmAudioBridge
}

/** Own a single bridge timer; cancellation also suppresses callbacks from older bridges. */
export function scheduleWasmAudioTimer(
  bridge: Pick<WasmAudioBridge, 'setTimer' | 'clearTimer'>,
  callback: () => void,
  delay: number,
): () => void {
  let active = true
  const run = () => {
    if (!active) return
    active = false
    callback()
  }
  const timer = bridge.setTimer ? bridge.setTimer(run, delay) : setTimeout(run, delay)
  return () => {
    if (!active) return
    active = false
    if (bridge.setTimer) bridge.clearTimer?.(timer)
    else clearTimeout(timer)
  }
}
