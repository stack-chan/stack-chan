export type FakeMP3StreamerOptions = {
  http: unknown
  host: string
  port: number
  path: string
  audio: { out: unknown; stream: number; sampleRate?: number }
  onReady?: (ready: boolean) => void
  onError?: (reason: string) => void
  onDone?: () => void
}

const instances: MP3Streamer[] = []

export default class MP3Streamer {
  closed = false
  options: FakeMP3StreamerOptions
  constructor(options: FakeMP3StreamerOptions) {
    this.options = options
    instances.push(this)
  }
  close(): void {
    this.closed = true
  }
}

export function getMP3StreamerInstances(): MP3Streamer[] {
  return instances
}

export function resetMP3Streamers(): void {
  instances.length = 0
}
