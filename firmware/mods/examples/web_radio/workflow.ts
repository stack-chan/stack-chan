import type { MediaSession, MediaState } from 'capabilities'
import { createVoiceScope, deferred } from 'stackchan/voice/scope'
import { type AsyncResult, andThenAsync, ensure, err, isErr, isOk, match, ok, type Result } from 'stackchan-result'
import {
  buildRadioDrawerOptions,
  formatRadioError,
  isConnectingState,
  OFF_VALUE,
  parseRadioSelection,
  type RadioError,
  type Station,
} from 'web-radio-domain'

const DEFAULT_DRAWER_KEY = 'web-radio:station'
const DEFAULT_DRAWER_LABEL = 'ラジオ'

export type NetworkStatus =
  | { readonly status: 'connected' }
  | { readonly status: 'skipped'; readonly reason: string }
  | { readonly status: 'failed'; readonly reason: string }

export type RadioNetworkPort = Readonly<{
  waitReady(): AsyncResult<NetworkStatus, RadioError>
}>

type RadioPlayback = Pick<MediaSession, 'state' | 'done' | 'stop'>

export type RadioPlaybackPort = Readonly<{
  open(options: {
    readonly url: string
    readonly signal: ReturnType<typeof createVoiceScope>['signal']
    readonly onStateChanged: (state: MediaState, reason?: string) => void
  }): AsyncResult<RadioPlayback, RadioError>
}>

type PlaybackAttempt = {
  readonly scope: ReturnType<typeof createVoiceScope>
  readonly opening: AsyncResult<RadioPlayback, RadioError>
  session?: RadioPlayback
}

export type RadioUiPort = Readonly<{
  showNotes(): void
  hideNotes(): void
  setConnectionIndicator(visible: boolean): void
  setFaceMotionEnabled(enabled: boolean): void
  showBalloon(text: string): void
  hideBalloon(): void
  addStationDrawer(options: {
    readonly key: string
    readonly label: string
    readonly value: string
    readonly options: Array<{ value: string; label: string }>
    readonly onSelect: (value: string) => void
  }): void
  removeStationDrawer?(key: string): void
}>

export type RadioWorkflowDeps = Readonly<{
  stations: readonly Station[]
  network?: RadioNetworkPort
  radio?: RadioPlaybackPort
  ui: RadioUiPort
  drawerKey?: string
  drawerLabel?: string
}>

export type RadioApp = Readonly<{
  start(): AsyncResult<() => Promise<void> | void, RadioError>
  select(value: string): AsyncResult<void, RadioError>
  stop(): Promise<void> | void
}>

export function createRadioApp(deps: RadioWorkflowDeps): RadioApp {
  const drawerKey = deps.drawerKey ?? DEFAULT_DRAWER_KEY
  const drawerLabel = deps.drawerLabel ?? DEFAULT_DRAWER_LABEL

  let generation = 0
  let closed = false
  let drawerAdded = false
  let playback: PlaybackAttempt | undefined
  let retiring: Promise<void> | undefined
  let selectedValue: string = deps.stations[0]?.value ?? OFF_VALUE
  let indicatorVisible = false
  let notesVisible = false
  let faceMotionPaused = false
  let balloonVisible = false

  const setIndicator = (visible: boolean): void => {
    if (indicatorVisible === visible) return
    indicatorVisible = visible
    deps.ui.setConnectionIndicator(visible)
  }

  const setNotes = (visible: boolean): void => {
    if (notesVisible === visible) return
    notesVisible = visible
    if (visible) deps.ui.showNotes()
    else deps.ui.hideNotes()
  }

  const pauseFaceMotion = (paused: boolean): void => {
    if (faceMotionPaused === paused) return
    faceMotionPaused = paused
    deps.ui.setFaceMotionEnabled(!paused)
  }

  const showError = (error: RadioError): void => {
    balloonVisible = true
    deps.ui.showBalloon(formatRadioError(error))
  }

  const hideError = (): void => {
    if (!balloonVisible) return
    balloonVisible = false
    deps.ui.hideBalloon()
  }

  const resetToIdle = (error?: RadioError): void => {
    setIndicator(false)
    setNotes(false)
    pauseFaceMotion(false)
    if (error) showError(error)
    else hideError()
  }

  const stopPlayback = (): Promise<void> | undefined => {
    const previous = playback
    if (!previous) return retiring
    playback = undefined
    const stopping = (async () => {
      if (previous.session) {
        await previous.session.stop()
      } else {
        previous.scope.abort()
        const opened = await previous.opening
        if (isOk(opened)) await opened.value.stop()
      }
    })()
    retiring = stopping
    const settled = () => {
      if (retiring === stopping) retiring = undefined
    }
    void stopping.then(settled, settled)
    return stopping
  }

  const cleanup = (): Promise<void> | void => {
    if (closed) return retiring
    closed = true
    generation += 1
    const stopping = stopPlayback()
    resetToIdle()
    if (drawerAdded) {
      drawerAdded = false
      deps.ui.removeStationDrawer?.(drawerKey)
    }
    return stopping
  }

  const onRadioState = (expectedGeneration: number, state: MediaState, reason?: string): void => {
    if (closed || expectedGeneration !== generation) return
    if (state === 'error') {
      resetToIdle({ kind: 'playback-failed', reason: reason ?? 'unknown error' })
      return
    }
    setIndicator(isConnectingState(state))
    if (state === 'playing') hideError()
    setNotes(state === 'playing')
  }

  const select = async (value: string): AsyncResult<void, RadioError> => {
    if (closed) return ok(undefined)
    const parsed = parseRadioSelection(value, deps.stations)
    if (isErr(parsed)) return parsed

    const selection = parsed.value
    const nextGeneration = ++generation
    selectedValue = value
    setIndicator(false)
    setNotes(false)
    hideError()
    try {
      const stopping = stopPlayback()
      if (stopping) await stopping
    } catch (cause) {
      if (closed || nextGeneration !== generation) return ok(undefined)
      const error: RadioError = { kind: 'playback-failed', reason: String(cause) }
      resetToIdle(error)
      return err(error)
    }
    if (closed || nextGeneration !== generation) return ok(undefined)

    if (selection.kind === 'off') {
      pauseFaceMotion(false)
      return ok(undefined)
    }

    const radioPort = ensure(deps.radio, (): RadioError => ({ kind: 'radio-unsupported' }))
    if (isErr(radioPort)) {
      resetToIdle(radioPort.error)
      return radioPort
    }

    pauseFaceMotion(true)
    if (closed || nextGeneration !== generation) return ok(undefined)

    const scope = createVoiceScope()
    const opening = deferred<Result<RadioPlayback, RadioError>>()
    const attempt: PlaybackAttempt = { scope, opening: opening.promise }
    playback = attempt

    let opened: Result<RadioPlayback, RadioError>
    try {
      opened = await radioPort.value.open({
        url: selection.station.url,
        signal: scope.signal,
        onStateChanged: (state, reason) => onRadioState(nextGeneration, state, reason),
      })
    } catch (cause) {
      opened = err({ kind: 'playback-failed', reason: String(cause) })
    }
    opening.resolve(opened)

    if (playback !== attempt) return ok(undefined)
    if (isErr(opened)) {
      playback = undefined
      resetToIdle(opened.error)
      return opened
    }
    const session = opened.value
    attempt.session = session
    const finish = () => {
      if (playback !== attempt) return
      playback = undefined
      if (session.state !== 'error') resetToIdle()
    }
    void session.done.then(finish, finish)
    return ok(undefined)
  }

  const start = async (): AsyncResult<() => Promise<void> | void, RadioError> => {
    if (closed) return ok(cleanup)
    const startGeneration = ++generation
    const networkReady = await andThenAsync(
      ensure(deps.network, (): RadioError => ({ kind: 'network-unavailable' })),
      async (network) =>
        andThenAsync(
          await network.waitReady(),
          (ready): Result<void, RadioError> =>
            ready.status === 'connected' ? ok(undefined) : err({ kind: 'network-offline', reason: ready.reason }),
        ),
    )

    if (closed || startGeneration !== generation) return ok(cleanup)

    return match<void, RadioError, AsyncResult<() => Promise<void> | void, RadioError>>(networkReady, {
      err: async (error) => {
        showError(error)
        return err(error)
      },
      ok: async () => {
        deps.ui.addStationDrawer({
          key: drawerKey,
          label: drawerLabel,
          value: selectedValue,
          options: buildRadioDrawerOptions(deps.stations),
          onSelect: (value) => {
            void select(value)
          },
        })
        drawerAdded = true
        await select(selectedValue)
        return ok(cleanup)
      },
    })
  }

  return {
    start,
    select,
    stop: cleanup,
  }
}
