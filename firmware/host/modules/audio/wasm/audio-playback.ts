import { asStackchanError, StackchanError } from 'stackchan/errors'
import {
  PLAYBACK_GRACE_MS,
  PLAYBACK_PREPARE_TIMEOUT_MS,
  PLAYBACK_RELEASE_TIMEOUT_MS,
} from 'stackchan-contracts/audio-playback'
import type { PlaybackSession } from 'tts-playback-session'
import {
  scheduleWasmAudioTimer,
  WASM_AUDIO_BRIDGE_POLL_INTERVAL_MS,
  type WasmAudioBridgeGlobal,
  type WasmAudioOutputBridge,
} from 'wasm-audio-bridge-contract'

export function getWasmAudioOutputBridge(): WasmAudioOutputBridge {
  const bridge = (globalThis as WasmAudioBridgeGlobal).__stackchanWasmAudioBridge
  if (!bridge) throw new StackchanError('UNSUPPORTED', 'Browser audio output is unavailable')
  for (const name of [
    'playAvailable',
    'playStatus',
    'playDetails',
    'stopPlay',
    'releasePlay',
    'startPlayBuffer',
    'startTone',
  ] as const) {
    if (typeof bridge[name] !== 'function')
      throw new StackchanError('UNSUPPORTED', 'Browser audio output bridge is incompatible')
  }
  if (!bridge.playAvailable()) throw new StackchanError('UNSUPPORTED', 'Browser audio output is unavailable')
  return bridge
}

export function wasmAudioOutputAvailable(): boolean {
  try {
    getWasmAudioOutputBridge()
    return true
  } catch {
    return false
  }
}

/** A playback handle owns its status polling and acknowledged browser release. */
export function playWasmAudio(
  session: PlaybackSession,
  bridge: WasmAudioOutputBridge,
  start: () => number,
  durationLimitMs: number,
): void {
  let id = 0
  let unknownStartFailure: StackchanError | undefined
  let clearPoll: (() => void) | undefined
  let clearDeadline: (() => void) | undefined
  session.addCleanup(
    () =>
      new Promise<void>((resolve, reject) => {
        let cleanupFailure: StackchanError | undefined = unknownStartFailure
        let finished = false
        let clearReleasePoll: (() => void) | undefined
        let clearReleaseDeadline: (() => void) | undefined
        const attempt = (action: (() => void) | undefined) => {
          try {
            action?.()
          } catch (error) {
            cleanupFailure ??= asStackchanError(error)
          }
        }
        const finish = (error?: unknown) => {
          if (finished) return
          finished = true
          if (error !== undefined) cleanupFailure ??= asStackchanError(error)
          attempt(clearReleasePoll)
          attempt(clearReleaseDeadline)
          if (id) attempt(() => bridge.releasePlay(id))
          if (cleanupFailure) reject(cleanupFailure)
          else resolve()
        }
        attempt(clearPoll)
        attempt(clearDeadline)
        if (!id) return finish()
        attempt(() => bridge.stopPlay(id))
        if (cleanupFailure) return finish()
        const poll = () => {
          if (finished) return
          clearReleasePoll = undefined
          try {
            const details = bridge.playDetails(id)
            if (details.releaseError)
              return finish(new StackchanError(details.releaseError.code, details.releaseError.message))
            if (details.quiet) return finish()
            clearReleasePoll = scheduleWasmAudioTimer(bridge, poll, WASM_AUDIO_BRIDGE_POLL_INTERVAL_MS)
          } catch (error) {
            finish(error)
          }
        }
        try {
          clearReleaseDeadline = scheduleWasmAudioTimer(
            bridge,
            () => finish(new StackchanError('TIMEOUT', 'Browser audio output release was not confirmed')),
            PLAYBACK_RELEASE_TIMEOUT_MS + PLAYBACK_GRACE_MS,
          )
          poll()
        } catch (error) {
          finish(error)
        }
      }),
  )

  try {
    if (session.closed) return
    try {
      id = start()
    } catch (error) {
      unknownStartFailure = asStackchanError(error)
      throw unknownStartFailure
    }
    if (!Number.isInteger(id) || id <= 0) {
      id = 0
      throw new StackchanError('BUSY', 'Browser audio output could not allocate a playback handle')
    }
    clearDeadline = scheduleWasmAudioTimer(
      bridge,
      () => session.fail(new StackchanError('TIMEOUT', 'Browser audio playback exceeded its deadline')),
      PLAYBACK_PREPARE_TIMEOUT_MS + durationLimitMs + PLAYBACK_GRACE_MS,
    )
    const poll = () => {
      if (session.closed) return
      clearPoll = undefined
      try {
        const status = bridge.playStatus(id)
        if (status === 0 || status === 2) {
          clearPoll = scheduleWasmAudioTimer(bridge, poll, WASM_AUDIO_BRIDGE_POLL_INTERVAL_MS)
          return
        }
        const details = bridge.playDetails(id)
        if (details.error) session.fail(new StackchanError(details.error.code, details.error.message))
        else if (status === 1 && details.quiet && !details.releaseError) session.onDone()
        else session.fail(new StackchanError('IO', 'Browser audio playback did not complete'))
      } catch (error) {
        session.fail(error)
      }
    }
    // Return to XS before reading a synchronous browser result.
    Promise.resolve().then(poll)
  } catch (error) {
    session.fail(error)
  }
}
