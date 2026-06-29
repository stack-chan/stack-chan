declare const setTimeout: (callback: () => void, delay?: number) => unknown

type WasmAudioBridge = {
  close: () => void
  playStatus: () => number
  setTimer?: (callback: () => void, delay?: number) => unknown
  startPlayBuffer: (buffer: ArrayBuffer) => void
  tone: (hz: number, duration: number, volume?: number) => void
}

type AudioBridgeGlobal = typeof globalThis & {
  __stackchanWasmAudioBridge?: WasmAudioBridge
  Host?: {
    AudioOut?: {
      close?: () => void
      play?: (buffer: ArrayBuffer) => Promise<boolean> | boolean
      tone?: (message: { hz: number; duration: number; volume?: number }) => Promise<void> | void
    }
  }
}

const getAudioBridge = (): WasmAudioBridge => {
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

const schedule = (audioBridge: WasmAudioBridge, callback: () => void, delay: number) => {
  if (audioBridge.setTimer) audioBridge.setTimer(callback, delay)
  else setTimeout(callback, delay)
}

export default class Tone {
  constructor(_options?: unknown) {
    void _options
  }

  async tone(hz: number, duration: number, volume?: number): Promise<void> {
    const audioBridge = getAudioBridge()
    audioBridge.tone(hz, duration, volume)
    return new Promise((resolve) => {
      schedule(audioBridge, resolve, duration + 250)
    })
  }

  async play(buffer: ArrayBuffer): Promise<boolean> {
    if (buffer.byteLength === 0) return false
    const audioBridge = getAudioBridge()
    audioBridge.startPlayBuffer(buffer)
    return new Promise((resolve) => {
      const poll = () => {
        const status = audioBridge.playStatus()
        if (status === 0) {
          schedule(audioBridge, poll, 50)
          return
        }
        resolve(status > 0)
      }
      poll()
    })
  }

  close() {
    getAudioBridge().close()
  }
}
