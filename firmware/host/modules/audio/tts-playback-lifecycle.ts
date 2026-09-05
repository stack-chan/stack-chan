import calculatePower from 'calculate-power'
import AudioOut from 'pins/audioout'
import { createPlaybackSession, type PlaybackOwner } from 'tts-playback-session'
import type { TTSCompletion } from 'tts-types'

type AudioOutOptions = {
  streams: number
  bitsPerSample?: number
  sampleRate?: number
  numChannels?: number
}

type Closable = { close?: () => void }
export type TTSPlaybackOwner = PlaybackOwner & { audio?: AudioOut }
export type TTSPlaybackLifecycle = {
  openAudio(options: AudioOutOptions, volume: number): AudioOut
  attach<T extends Closable>(streamer: T): T
  addCleanup(cleanup: () => void): void
  onPlayed(buffer: ArrayBuffer): void
  onPower(power: number): void
  onReady(state: boolean): void
  onError(error: unknown): void
  onDone(): void
  fail(error: unknown): void
  cancel(reason?: unknown): void
}

export function createTTSPlaybackLifecycle(owner: TTSPlaybackOwner, callback?: TTSCompletion): TTSPlaybackLifecycle {
  const session = createPlaybackSession(owner, callback)
  let audio: AudioOut | undefined
  return {
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
    onPlayed(buffer) {
      if (!session.closed) session.onPower(calculatePower(buffer))
    },
    onPower: session.onPower,
    onReady(state) {
      if (session.closed || !audio) return
      if (state) audio.start()
      else audio.stop()
    },
    onError: session.fail,
    onDone: session.onDone,
    fail: session.fail,
    cancel: session.cancel,
  }
}

export function beginTTSPlayback(owner: TTSPlaybackOwner, callback?: TTSCompletion): TTSPlaybackLifecycle | undefined {
  if (owner.streaming) {
    callback?.(new Error('already playing'))
    return undefined
  }
  return createTTSPlaybackLifecycle(owner, callback)
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
