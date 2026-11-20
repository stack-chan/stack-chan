export type FakeMP3StreamerOptions = {
  protocol?: 'http' | 'https'
  http: unknown
  host: string
  port: number
  path: string
  mode?: 'live' | 'finite'
  seek?: { offset: number; seconds: number; target: number }
  source?: { url: string; totalBytes?: number; validator?: string }
  onSource?: (source: { url: string; totalBytes?: number; validator?: string }, reset: boolean) => void
  onMetadata?: (metadata: { duration?: number; estimated: boolean }) => void
  onCheckpoint?: (point: { offset: number; seconds: number }) => void
  onOutputStart?: (seconds: number) => void
  reconnect?: boolean
  audio: { out: unknown; stream: number; sampleRate?: number }
  onReady?: (ready: boolean) => void
  onPlayed?: (buffer?: unknown) => void
  onError?: (reason: string) => void
  onDone?: () => void
}

let constructorFailure: unknown
const instances: MP3Streamer[] = []

export default class MP3Streamer {
  closed = false
  options: FakeMP3StreamerOptions
  constructor(options: FakeMP3StreamerOptions) {
    if (constructorFailure !== undefined) throw constructorFailure
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
  constructorFailure = undefined
  instances.length = 0
}

export function setMP3StreamerConstructorFailure(error: unknown): void {
  constructorFailure = error
}
