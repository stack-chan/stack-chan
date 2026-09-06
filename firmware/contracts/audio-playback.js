/** Shared limits for buffered browser playback and tone operations. */
export const DEFAULT_PLAYBACK_VOLUME = 0.5
// Includes a complete 60-second, 24 kHz mono WAV from stackchan-voice.
export const MAX_PLAYBACK_BYTES = 3 * 1024 * 1024
export const MAX_PLAYBACK_DURATION_MS = 60_000
export const MAX_TONE_DURATION_MS = 60_000
export const PLAYBACK_PREPARE_TIMEOUT_MS = 30_000
export const PLAYBACK_GRACE_MS = 1_000
export const PLAYBACK_RELEASE_TIMEOUT_MS = 2_000
