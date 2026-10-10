declare module "wavstreamer" {
  import type AudioOut from "pins/audioout"
  import type { HTTPClientProvider } from "embedded:network/http/client";
  type WavStreamerOptions = {
    http: HTTPClientProvider
    host: string,
    port: number,
    path: string,
    audio: {
      out: AudioOut,
      sampleRate?: number,
      stream: number,
    },
    bufferDuration?: number,
    request?: any,
    waveHeaderBytes?: number,
    onPlayed?: (buffer: ArrayBuffer) => void
    onReady?: (state: boolean) => void
    onError?: (message: string) => void
    onDone?: () => void
  }
  export default class WavStreamer {
    constructor(options: WavStreamerOptions);
    close(): void;
  }
}
