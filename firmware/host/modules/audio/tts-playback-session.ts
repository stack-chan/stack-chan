import type { TTSCompletion, TTSDoneListener, TTSPlaybackListener } from 'tts-types'

export type PlaybackOwner = {
  streaming: boolean
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
  cancelPlayback?: (reason?: unknown) => void
}

export type PlaybackSession = {
  readonly closed: boolean
  addCleanup(cleanup: () => void): void
  onPower(power: number): void
  onDone(): void
  fail(error: unknown): void
  cancel(reason?: unknown): void
}

/** Shared by native and WASM providers; contains no device or audio imports. */
export function createPlaybackSession(owner: PlaybackOwner, callback?: TTSCompletion): PlaybackSession {
  let completed = false
  const cleanupTasks: (() => void)[] = []
  owner.streaming = true
  const cleanup = (close: () => void) => {
    try {
      close()
    } catch (error) {
      ;(globalThis as typeof globalThis & { trace?: (message: string) => void }).trace?.(
        `TTS cleanup error: ${String(error)}\n`,
      )
    }
  }
  const finish = (error?: unknown) => {
    if (completed) return
    completed = true
    owner.streaming = false
    if (owner.cancelPlayback === cancel) owner.cancelPlayback = undefined
    while (cleanupTasks.length) {
      const close = cleanupTasks.pop()
      if (close) cleanup(close)
    }
    try {
      owner.onDone?.()
    } finally {
      callback?.(error)
    }
  }
  const cancel = (reason: unknown = new Error('Playback cancelled')) => finish(reason)
  owner.cancelPlayback = cancel
  return {
    get closed() {
      return completed
    },
    addCleanup(close) {
      if (completed) cleanup(close)
      else cleanupTasks.push(close)
    },
    onPower(power) {
      if (!completed) owner.onPlayed?.(power)
    },
    onDone() {
      finish()
    },
    fail: finish,
    cancel,
  }
}

export function beginPlaybackSession(owner: PlaybackOwner, callback?: TTSCompletion): PlaybackSession | undefined {
  if (owner.streaming) {
    callback?.(new Error('already playing'))
    return undefined
  }
  return createPlaybackSession(owner, callback)
}
