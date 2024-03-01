declare module "mp3streamer" {
  import type AudioOut from "pins/audioout"
  import HTTPClient from "embedded:network/http/client";
  type MP3StreamerOptions = {
    http: typeof HTTPClient.constructor
    host: string,
    port: number,
    path: string,
    audio: {
      out: AudioOut,
      sampleRate?: number,
      stream: number,
    },
    request?: any,
    onPlayed?: (buffer: ArrayBuffer) => void
    onReady?: (state: boolean) => void
    onError?: (message: string) => void
    onDone?: () => void
  }
  export default class MP3Streamer {
    constructor(options: MP3StreamerOptions);
    close(): void;
  }
}
