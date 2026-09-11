import { asStackchanError, StackchanError } from 'stackchan/errors'
import type { TTSCompletion, TTSDoneListener, TTSPlaybackListener } from 'tts-types'

export type PlaybackOwner = {
  streaming: boolean
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
  cancelPlayback?: (reason?: unknown) => void | Promise<void>
}

type Cleanup = () => void | Promise<void>
export type PlaybackSession = {
  readonly closed: boolean
  /** Rejects only when resource release fails; cancellation is a playback result. */
  readonly released: Promise<void>
  addCleanup(cleanup: Cleanup): void
  waitFor<T>(operation: Promise<T>): Promise<T>
  onPower(power: number): void
  onDone(): void
  fail(error: unknown): void
  cancel(reason?: unknown): Promise<void>
}

type OwnerState = { closed: boolean; session?: PlaybackSession; failure?: StackchanError }
// Moddable preloads freeze module-level objects. Allocate mutable ownership
// state only when the running VM starts its first operation.
let owners: WeakMap<object, OwnerState> | undefined
function stateFor(owner: object): OwnerState {
  owners ??= new WeakMap<object, OwnerState>()
  let state = owners.get(owner)
  if (!state) {
    state = { closed: false }
    owners.set(owner, state)
  }
  return state
}

export function playbackReleaseFailure(owner: object): StackchanError | undefined {
  return owners?.get(owner)?.failure
}

/** Permanently close the provider, including an operation already finishing. */
export function closePlaybackOwner(owner: PlaybackOwner): void | Promise<void> {
  const state = stateFor(owner)
  state.closed = true
  if (state.session) return state.session.cancel(new StackchanError('CLOSED', 'Audio provider is closed'))
  if (state.failure) throw state.failure
}

/** Shared provider state; concrete implementations only supply synthesis or playback. */
export class PlaybackProvider implements PlaybackOwner {
  streaming = false
  onPlayed?: TTSPlaybackListener
  onDone?: TTSDoneListener
  cancelPlayback?: (reason?: unknown) => void | Promise<void>

  constructor(options: Pick<PlaybackOwner, 'onPlayed' | 'onDone'> = {}) {
    this.onPlayed = options.onPlayed
    this.onDone = options.onDone
  }

  close(): void | Promise<void> {
    return closePlaybackOwner(this)
  }
}

function assertAvailable(owner: PlaybackOwner): void {
  const state = stateFor(owner)
  if (state.failure) throw state.failure
  if (state.closed) throw new StackchanError('CLOSED', 'Audio provider is closed')
  if (state.session || owner.streaming) throw new StackchanError('BUSY', 'Audio provider is already playing')
}

/** Shared ownership and completion for native and WASM providers. */
export function createPlaybackSession(owner: PlaybackOwner, callback?: TTSCompletion): PlaybackSession {
  assertAvailable(owner)
  const state = stateFor(owner)
  const cleanups: Cleanup[] = []
  let stopping = false,
    released = false,
    draining = false
  let pending = 0
  let resultError: unknown
  let resolveReleased!: () => void
  let rejectReleased!: (error: StackchanError) => void
  const release = new Promise<void>((yes, no) => {
    resolveReleased = yes
    rejectReleased = no
  })
  release.catch(() => {})
  const recordFailure = (error: unknown) => {
    state.failure ??= asStackchanError(error)
    if (state.session && state.session !== session) state.session.cancel(state.failure).catch(() => {})
  }
  const report = (error: unknown) => {
    ;(globalThis as typeof globalThis & { trace?: (text: string) => void }).trace?.(
      `Audio callback error: ${String(error)}\n`,
    )
  }
  const complete = () => {
    if (!stopping || released || draining || pending || cleanups.length) return
    released = true
    owner.streaming = false
    if (owner.cancelPlayback === cancel) owner.cancelPlayback = undefined
    if (state.session === session) state.session = undefined
    let error = state.failure ?? resultError
    try {
      owner.onDone?.()
    } catch (caught) {
      error ??= asStackchanError(caught)
    }
    if (state.failure) rejectReleased(state.failure)
    else resolveReleased()
    try {
      callback?.(error)
    } catch (caught) {
      report(caught)
    }
  }
  const closeResource = (close: Cleanup) => {
    try {
      const result = close()
      if (result && result !== release) return Promise.resolve(result).catch(recordFailure)
    } catch (error) {
      recordFailure(error)
    }
  }
  const drain = () => {
    if (!stopping || released || draining) return
    draining = true
    while (cleanups.length) {
      const close = cleanups.pop()
      const pendingClose = close && closeResource(close)
      if (pendingClose) {
        // A streamer must stop writing before its output is released.
        pendingClose.then(() => {
          draining = false
          drain()
        })
        return
      }
    }
    draining = false
    complete()
  }
  const finish = (error?: unknown) => {
    if (stopping) return
    stopping = true
    resultError = error
    // A constructor may report completion before returning its resource.
    // Native audio callbacks must also return to C before their output closes.
    Promise.resolve().then(drain)
  }
  const cancel = (reason?: unknown) => {
    finish(reason instanceof Error ? reason : new StackchanError('CANCELLED', 'Playback cancelled', { cause: reason }))
    return release
  }
  const session: PlaybackSession = {
    get closed() {
      return stopping
    },
    released: release,
    addCleanup(close) {
      if (released) closeResource(close)
      else {
        cleanups.push(close)
        if (stopping && !draining) Promise.resolve().then(drain)
      }
    },
    waitFor(operation) {
      // Continuations hold completion, but cannot block their own cancellation
      // cleanup (for example, clearing a renderer's timer and settling it).
      pending++
      const settled = () => {
        pending--
        drain()
      }
      operation.then(settled, settled)
      return operation
    },
    onPower(power) {
      if (stopping) return
      try {
        owner.onPlayed?.(power)
      } catch (error) {
        finish(asStackchanError(error))
      }
    },
    onDone() {
      finish()
    },
    fail(error) {
      if (!stopping) finish(asStackchanError(error))
    },
    cancel,
  }
  state.session = session
  owner.streaming = true
  owner.cancelPlayback = cancel
  return session
}

export function beginPlaybackSession(owner: PlaybackOwner, callback?: TTSCompletion): PlaybackSession | undefined {
  try {
    return createPlaybackSession(owner, callback)
  } catch (error) {
    callback?.(error)
    return undefined
  }
}
