declare module 'resourcestreamer' {
  import type AudioOut from 'pins/audioout'
  type ResourceStreamerOptions = {
    path: string
    audio: {
      out: AudioOut
      sampleRate: number
      stream: number
    }
    onPlayed?: (buffer: ArrayBuffer) => void
    onReady?: (state: boolean) => void
    onError?: (message: string) => void
    onDone?: () => void
  }
  export default class ResourceStreamer {
    audio: AudioOut
    constructor(options: ResourceStreamerOptions)
    close(): void
  }
}
