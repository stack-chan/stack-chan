import calculatePower from 'calculate-power'
import AudioOut from 'pins/audioout'
import { type TelemetryFields, getTelemetry, truncateReason } from 'telemetry'
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
  /** Engine label recorded in telemetry events, e.g. "voicevox" */
  telemetryName?: string
}

export type TTSPlaybackLifecycle = {
  openAudio(options: AudioOutOptions, volume: number): AudioOut
  attach<T extends Closable>(streamer: T): T
  addCleanup(cleanup: () => void): void
  onPlayed(buffer: ArrayBuffer): void
  onReady(state: boolean): void
  onError(error: unknown): void
  onDone(): void
  fail(error: unknown): void
}

/**
 * Maps a raw playback error onto the stable error-code vocabulary of
 * docs/specs/log-schema.md so failures can be aggregated across engines.
 */
export function classifyTTSError(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
  if (message.includes('already playing')) return 'E_TTS_BUSY'
  if (message.includes('server returned')) return 'E_TTS_HTTP'
  if (message.includes('socket') || message.includes('connect') || message.includes('dns')) return 'E_TTS_NET'
  if (message.includes('abort')) return 'E_TTS_ABORTED'
  return 'E_TTS_ERROR'
}

function closeResource(close: (() => void) | undefined): void {
  try {
    close?.()
  } catch (error) {
    trace(`TTS cleanup error: ${String(error)}\n`)
  }
}

export function createTTSPlaybackLifecycle(owner: TTSPlaybackOwner, callback?: TTSCompletion): TTSPlaybackLifecycle {
  const telemetry = getTelemetry()
  const span = telemetry.begin('tts', 'playback', { engine: owner.telemetryName ?? 'tts' })
  let completed = false
  let streamer: Closable | undefined
  const cleanupTasks: (() => void)[] = []

  // Distinguishes TTS dropout causes: `stalls`/`stallMs` count buffer
  // underruns (onReady false→true round trips after playback started),
  // `maxGapMs` exposes scheduling delays between played blocks, and
  // `firstAudioMs` captures network/synthesis latency before first audio.
  let audioStarted = false
  let stallStartedAt = -1
  let stallCount = 0
  let stallTotalMs = 0
  let firstAudioMs = -1
  let playedCount = 0
  let lastPlayedAt = -1
  let maxPlayedGapMs = 0

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

    if (stallStartedAt >= 0) {
      stallCount += 1
      stallTotalMs += telemetry.now() - stallStartedAt
      stallStartedAt = -1
    }
    const summary: TelemetryFields = {
      played: playedCount,
      stalls: stallCount,
      stallMs: stallTotalMs,
      maxGapMs: maxPlayedGapMs,
    }
    if (firstAudioMs >= 0) summary.firstAudioMs = firstAudioMs
    if (error == null) {
      span.end({ data: summary })
    } else {
      summary.reason = truncateReason(String(error))
      span.fail(classifyTTSError(error), { data: summary })
    }

    owner.onDone?.()
    callback?.(error)
  }

  return {
    openAudio(options: AudioOutOptions, volume: number): AudioOut {
      const audio = new AudioOut(options)
      audio.enqueue(0, AudioOut.Volume, Math.round(volume * 256))
      owner.audio = audio
      span.mark('playback.audio_open', { data: { sampleRate: options.sampleRate ?? 0 } })
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
      const now = telemetry.now()
      if (lastPlayedAt >= 0 && now - lastPlayedAt > maxPlayedGapMs) maxPlayedGapMs = now - lastPlayedAt
      lastPlayedAt = now
      playedCount += 1
      owner.onPlayed?.(calculatePower(buffer))
    },
    onReady(state: boolean): void {
      if (completed || !owner.audio) return
      if (state) {
        if (!audioStarted) {
          audioStarted = true
          firstAudioMs = span.elapsed()
          span.mark('playback.first_audio')
        } else if (stallStartedAt >= 0) {
          const stallMs = telemetry.now() - stallStartedAt
          stallStartedAt = -1
          stallCount += 1
          stallTotalMs += stallMs
          span.mark('playback.stall', { data: { stallMs } })
        }
        owner.audio.start()
      } else {
        if (audioStarted && stallStartedAt < 0) stallStartedAt = telemetry.now()
        owner.audio.stop()
      }
    },
    onError(error: unknown): void {
      finish(error)
    },
    onDone(): void {
      finish()
    },
    fail(error: unknown): void {
      finish(error)
    },
  }
}

export function beginTTSPlayback(owner: TTSPlaybackOwner, callback?: TTSCompletion): TTSPlaybackLifecycle | undefined {
  if (owner.streaming) {
    getTelemetry().emit('tts', 'playback.rejected', {
      err: 'E_TTS_BUSY',
      data: { engine: owner.telemetryName ?? 'tts' },
    })
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
