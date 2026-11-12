import type { Scope } from '../voice/contracts.js'

export type MediaState = WebRadioState | 'ended' | 'paused'

export type MediaProgress = {
  position: number
  duration?: number
  estimated: boolean
  positionEstimated?: boolean
  seekable: boolean
}

export type MediaStartOptions = {
  url: string
  mode: 'live' | 'finite'
  seekAccuracy?: 'exact' | 'approximate'
  volume?: number
  /** Optional RSS duration hint in seconds. */
  duration?: number
  onProgress?: (progress: MediaProgress) => void
  /** Applies only to live playback. Finite playback never restarts automatically. */
  reconnect?: boolean
  onStateChanged?: (state: MediaState, reason?: string) => void
}

export type LiveMediaSource = { mode: 'live'; url: string; reconnect?: boolean }
export type FiniteMediaSource = {
  mode: 'finite'
  url: string
  duration?: number
  seekAccuracy?: 'exact' | 'approximate'
}
export type MediaOpenOptions = Scope & Pick<MediaStartOptions, 'volume' | 'onStateChanged' | 'onProgress'>
export interface MediaSession {
  readonly state: MediaState
  readonly progress: MediaProgress
  readonly done: Promise<'ended' | 'stopped'>
  setVolume(volume: number): void
  stop(): Promise<void>
}
export interface FiniteMediaSession extends MediaSession {
  pause(): Promise<void>
  resume(): Promise<void>
  seek(seconds: number): Promise<void>
}
export interface MediaPlayer {
  open(source: LiveMediaSource, options: MediaOpenOptions): Promise<MediaSession>
  open(source: FiniteMediaSource, options: MediaOpenOptions): Promise<FiniteMediaSession>
}
export type MediaCapability = MediaPlayer & {
  readonly state: MediaState
  start(options: MediaStartOptions): Promise<void>
  readonly progress: MediaProgress
  pause(): void
  resume(): Promise<void>
  seek(seconds: number): Promise<void>
  stop(): Promise<void> | void
  setVolume(volume: number): void
}

export type WebRadioState = 'idle' | 'connecting' | 'buffering' | 'playing' | 'stalled' | 'retrying' | 'error'

export type WebRadioStartOptions = {
  url: string
  volume?: number
  sampleRate?: number
  reconnect?: boolean
  onStateChanged?: (state: WebRadioState, reason?: string) => void
}

export type WebRadioCapability = {
  readonly state: WebRadioState
  start(options: WebRadioStartOptions): Promise<void>
  stop(): Promise<void> | void
  setVolume(volume: number): void
}
