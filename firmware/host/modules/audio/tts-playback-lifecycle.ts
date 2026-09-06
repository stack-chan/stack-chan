import calculatePower from 'calculate-power'
import AudioOut from 'pins/audioout'
import {
  beginPlaybackSession,
  createPlaybackSession,
  type PlaybackOwner,
  type PlaybackSession,
} from 'tts-playback-session'
import type { TTSCompletion } from 'tts-types'

type AudioOutOptions = {
  streams: number
  bitsPerSample?: number
  sampleRate?: number
  numChannels?: number
}

type Closable = { close?: () => void | Promise<void> }
export type TTSPlaybackOwner = PlaybackOwner & { audio?: AudioOut }
export type TTSPlaybackLifecycle = {
  readonly closed: boolean
  readonly released: Promise<void>
  openAudio(options: AudioOutOptions, volume: number): AudioOut
  attach<T extends Closable>(streamer: T): T
  addCleanup(cleanup: () => void | Promise<void>): void
  waitFor<T>(operation: Promise<T>): Promise<T>
  onPlayed(buffer: ArrayBuffer): void
  onPower(power: number): void
  onReady(state: boolean): void
  onError(error: unknown): void
  onDone(): void
  fail(error: unknown): void
  cancel(reason?: unknown): Promise<void>
}

export function createTTSPlaybackLifecycle(owner: TTSPlaybackOwner, callback?: TTSCompletion): TTSPlaybackLifecycle {
  const session = createPlaybackSession(owner, callback)
  return withAudio(owner, session)
}

function withAudio(owner: TTSPlaybackOwner, session: PlaybackSession): TTSPlaybackLifecycle {
  let audio: AudioOut | undefined
  return {
    get closed() {
      return session.closed
    },
    released: session.released,
    openAudio(options, volume) {
      if (session.closed) throw new Error('Playback is closed')
      const output = new AudioOut(options)
      audio = owner.audio = output
      session.addCleanup(() => {
        try {
          output.close()
        } finally {
          if (owner.audio === output) owner.audio = undefined
          if (audio === output) audio = undefined
        }
      })
      output.enqueue(0, AudioOut.Volume, Math.round(volume * 256))
      return output
    },
    attach<T extends Closable>(streamer: T): T {
      session.addCleanup(() => streamer.close?.())
      return streamer
    },
    addCleanup: session.addCleanup,
    waitFor: session.waitFor,
    onPlayed(buffer) {
      if (session.closed) return
      try {
        session.onPower(calculatePower(buffer))
      } catch (error) {
        session.fail(error)
      }
    },
    onPower: session.onPower,
    onReady(state) {
      if (session.closed || !audio) return
      try {
        if (state) audio.start()
        else audio.stop()
      } catch (error) {
        session.fail(error)
      }
    },
    onError: session.fail,
    onDone: session.onDone,
    fail: session.fail,
    cancel: session.cancel,
  }
}

export function beginTTSPlayback(owner: TTSPlaybackOwner, callback?: TTSCompletion): TTSPlaybackLifecycle | undefined {
  const session = beginPlaybackSession(owner, callback)
  return session ? withAudio(owner, session) : undefined
}

export function runTTSPlayback(
  owner: TTSPlaybackOwner,
  callback: TTSCompletion | undefined,
  start: (lifecycle: TTSPlaybackLifecycle) => void,
): void {
  const lifecycle = beginTTSPlayback(owner, callback)
  if (!lifecycle) return
  try {
    start(lifecycle)
  } catch (error) {
    lifecycle.fail(error)
  }
}
