import calculatePower from 'calculate-power'
import AudioOut from 'pins/audioout'
import type { TTSCompletion, TTSDoneListener, TTSPlaybackListener } from 'tts-types'

type AudioOutOptions = {
  streams: number
  bitsPerSample?: number
  sampleRate?: number
  numChannels?: number
}

type Closable = {
  close?: () => void
}

export type TTSPlaybackOwner = {
  audio?: AudioOut
  streaming: boolean
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
}

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
}

function closeResource(close: (() => void) | undefined): void {
  try {
    close?.()
  } catch (error) {
    trace(`TTS cleanup error: ${String(error)}\n`)
  }
}

export function createTTSPlaybackLifecycle(owner: TTSPlaybackOwner, callback?: TTSCompletion): TTSPlaybackLifecycle {
  let completed = false
  let streamer: Closable | undefined
  const cleanupTasks: (() => void)[] = []

  const finish = (error?: unknown): void => {
    if (completed) return
    completed = true
    owner.streaming = false

    for (let index = cleanupTasks.length - 1; index >= 0; index -= 1) {
      closeResource(cleanupTasks[index])
    }
    closeResource(() => streamer?.close?.())
    closeResource(() => owner.audio?.close())
    owner.audio = undefined

    owner.onDone?.()
    callback?.(error)
  }

  return {
    openAudio(options: AudioOutOptions, volume: number): AudioOut {
      const audio = new AudioOut(options)
      audio.enqueue(0, AudioOut.Volume, Math.round(volume * 256))
      owner.audio = audio
      return audio
    },
    attach<T extends Closable>(nextStreamer: T): T {
      streamer = nextStreamer
      return nextStreamer
    },
    addCleanup(cleanup: () => void): void {
      cleanupTasks.push(cleanup)
    },
    onPlayed(buffer: ArrayBuffer): void {
      if (completed) return
      owner.onPlayed?.(calculatePower(buffer))
    },
    onPower(power: number): void {
      if (completed) return
      owner.onPlayed?.(power)
    },
    onReady(state: boolean): void {
      if (completed || !owner.audio) return
      trace(`Ready: ${state}\n`)
      if (state) owner.audio.start()
      else owner.audio.stop()
    },
    onError(error: unknown): void {
      trace('ERROR: ', String(error), '\n')
      finish(error)
    },
    onDone(): void {
      trace('DONE\n')
      finish()
    },
    fail(error: unknown): void {
      trace('ERROR: ', String(error), '\n')
      finish(error)
    },
  }
}

export function beginTTSPlayback(owner: TTSPlaybackOwner, callback?: TTSCompletion): TTSPlaybackLifecycle | undefined {
  if (owner.streaming) {
    callback?.(new Error('already playing'))
    return undefined
  }
  owner.streaming = true
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
