import type { StackchanErrorCode } from 'stackchan/errors'

export const WASM_AUDIO_BRIDGE_POLL_INTERVAL_MS = 50
declare const setTimeout: (callback: () => void, delay: number) => unknown
declare const clearTimeout: (handle: unknown) => void

export type WasmAudioBridge = {
  close: () => void
  playStatus: () => number
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
  startPlayBuffer: (buffer: ArrayBuffer) => void
  startRecord: (duration: number) => number
  stopRecord: (id: number) => void
  releaseRecord: (id: number) => void
  tone: (hz: number, duration: number, volume?: number) => void
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
  'close' | 'playStatus' | 'setTimer' | 'clearTimer' | 'startPlayBuffer' | 'tone'
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
