declare module "mp3streamer" {
  import type AudioOut from "pins/audioout"
  import type { HTTPClientProvider } from "embedded:network/http/client";
  export type CBRSeekInfo = {
    offset: number; bitRate: number; sampleRate: number; version: number; layer: number
  }
  export type MP3StreamerOptions<Output = AudioOut> = {
    protocol?: "http" | "https",
    http: HTTPClientProvider
    host: string,
    port: number,
    path: string,
    reconnect?: boolean,
    mode?: "live" | "finite",
    seek?: { offset: number; seconds: number; target: number; estimated?: boolean; synchronize?: boolean; cbr?: CBRSeekInfo }
    source?: { url: string; totalBytes?: number; validator?: string }
    onSource?: (source: { url: string; totalBytes?: number; validator?: string }, reset: boolean) => void
    onMetadata?: (metadata: { duration?: number; estimated: boolean }) => void
    onCheckpoint?: (point: { offset: number; seconds: number; estimated?: boolean }) => void
    onOutputStart?: (seconds: number, estimated?: boolean) => void
    onSeekInfo?: (info: CBRSeekInfo | null) => void
    onSeekInvalid?: () => void
    audio: {
      out: Output,
      sampleRate?: number,
      stream: number,
    },
    request?: any,
    onPlayed?: (buffer: ArrayBuffer) => void
    onReady?: (state: boolean) => void
    onError?: (message: string) => void
    onRetry?: (reason: string) => void
    onDone?: () => void
  }
  export default class MP3Streamer {
    constructor(options: MP3StreamerOptions);
    close(): void;
  }
}

declare module "buffered-mp3streamer" {
  import type AudioOut from "pins/audioout"
  import type { MP3StreamerOptions } from "mp3streamer"
  // CoreS3's worker streamer uses a shared PCM ring instead of Mixer callbacks.
  interface SharedPCMOutput {
    attachSharedOutput(
      output: { readableView(maximum?: number): Uint8Array; advanceRead(count: number): void },
      completion: Int32Array,
      onWritten: () => void,
    ): void
    detachSharedOutput(output: { readableView(maximum?: number): Uint8Array; advanceRead(count: number): void }): void
    pumpSharedOutput(): void
    start(): void
    close(): Promise<void>
  }
  export default class BufferedMP3Streamer {
    constructor(options: MP3StreamerOptions<AudioOut | SharedPCMOutput>);
    close(): Promise<void>;
  }
}
