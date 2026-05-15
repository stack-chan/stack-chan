declare const setTimeout: (callback: () => void, delay?: number) => unknown

type WasmAudioBridge = {
  close: () => void
  recordBuffer: () => ArrayBuffer
  recordStatus: () => number
  setTimer?: (callback: () => void, delay?: number) => unknown
  startRecord: (duration: number) => void
}

type AudioBridgeGlobal = typeof globalThis & {
  __stackchanWasmAudioBridge?: WasmAudioBridge
  Host?: {
    AudioIn?: {
      close?: () => void
      record?: (durationMilliSec: number) => Promise<ArrayBuffer> | ArrayBuffer
    }
  }
}

const getAudioBridge = (): WasmAudioBridge => {
  const env = globalThis as AudioBridgeGlobal
  let recorded = new ArrayBuffer(0)
  let status = -1
  return (
    env.__stackchanWasmAudioBridge ?? {
      close: () => env.Host?.AudioIn?.close?.(),
      recordBuffer: () => recorded,
      recordStatus: () => status,
      startRecord: (duration) => {
        status = 0
        Promise.resolve(env.Host?.AudioIn?.record?.(duration) ?? new ArrayBuffer(0)).then((buffer) => {
          recorded = buffer
          status = 1
        })
      },
    }
  )
}

const schedule = (audioBridge: WasmAudioBridge, callback: () => void, delay: number) => {
  if (audioBridge.setTimer) audioBridge.setTimer(callback, delay)
  else setTimeout(callback, delay)
}

export default class Microphone {
  constructor(_options?: unknown) {
    void _options
  }

  async record(durationMilliSec = 3000): Promise<ArrayBuffer> {
    const audioBridge = getAudioBridge()
    audioBridge.startRecord(durationMilliSec)
    return new Promise((resolve) => {
      const poll = () => {
        const status = audioBridge.recordStatus()
        if (status === 0) {
          schedule(audioBridge, poll, 50)
          return
        }
        resolve(status > 0 ? audioBridge.recordBuffer() : new ArrayBuffer(0))
      }
      poll()
    })
  }

  close() {
    getAudioBridge().close()
  }
}
