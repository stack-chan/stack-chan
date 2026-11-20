export const WASM_AUDIO_BRIDGE_POLL_INTERVAL_MS = 50

export type WasmAudioBridge = {
  close: () => void
  playStatus: () => number
  recordBuffer: () => ArrayBuffer
  recordError?: () => string | undefined
  recordStatus: () => number
  setTimer?: (callback: () => void, delay?: number) => unknown
  startPlayBuffer: (buffer: ArrayBuffer) => void
  startRecord: (duration: number) => void
  tone: (hz: number, duration: number, volume?: number) => void
}

export type WasmAudioInputBridge = Pick<
  WasmAudioBridge,
  'close' | 'recordBuffer' | 'recordError' | 'recordStatus' | 'setTimer' | 'startRecord'
>

export type WasmAudioOutputBridge = Pick<
  WasmAudioBridge,
  'close' | 'playStatus' | 'setTimer' | 'startPlayBuffer' | 'tone'
>

export type WasmAudioBridgeGlobal = typeof globalThis & {
  __stackchanWasmAudioBridge?: WasmAudioBridge
}
