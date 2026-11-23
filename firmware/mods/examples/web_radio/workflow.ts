import { andThenAsync, type AsyncResult, ensure, err, isErr, match, ok, type Result } from 'stackchan-result'
import {
  buildRadioDrawerOptions,
  formatRadioError,
  isConnectingState,
  OFF_VALUE,
  parseRadioSelection,
  type RadioError,
  type RadioPlaybackState,
  type Station,
} from 'web-radio-domain'

const DEFAULT_DRAWER_KEY = 'web-radio:station'
const DEFAULT_DRAWER_LABEL = 'ラジオ'
const DEFAULT_SAMPLE_RATE = 44100

export type NetworkStatus =
  | { readonly status: 'connected' }
  | { readonly status: 'skipped'; readonly reason: string }
  | { readonly status: 'failed'; readonly reason: string }

export type RadioNetworkPort = Readonly<{
  waitReady(): AsyncResult<NetworkStatus, RadioError>
}>

export type RadioPlaybackPort = Readonly<{
  start(options: {
    readonly url: string
    readonly sampleRate: number
    readonly reconnect: boolean
    readonly onStateChanged: (state: RadioPlaybackState, reason?: string) => void
  }): AsyncResult<void, RadioError>
  stop(): Promise<void> | void
}>

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
  sampleRate?: number
}>

export type RadioApp = Readonly<{
  start(): AsyncResult<() => Promise<void> | void, RadioError>
  select(value: string): AsyncResult<void, RadioError>
  stop(): Promise<void> | void
}>

export function createRadioApp(deps: RadioWorkflowDeps): RadioApp {
  const drawerKey = deps.drawerKey ?? DEFAULT_DRAWER_KEY
  const drawerLabel = deps.drawerLabel ?? DEFAULT_DRAWER_LABEL
  const sampleRate = deps.sampleRate ?? DEFAULT_SAMPLE_RATE

  let generation = 0
  let closed = false
  let drawerAdded = false
  let hasActivePlayback = false
  let selectedValue: string = deps.stations[0]?.value ?? OFF_VALUE

  const resetToIdle = (error?: RadioError): void => {
    deps.ui.setConnectionIndicator(false)
    deps.ui.hideNotes()
    deps.ui.setFaceMotionEnabled(true)
    if (error) {
      deps.ui.showBalloon(formatRadioError(error))
    } else {
      deps.ui.hideBalloon()
    }
  }

  const cleanup = (): Promise<void> | void => {
    if (closed) return
    closed = true
    generation += 1
    let stopping: Promise<void> | void
    if (hasActivePlayback) {
      hasActivePlayback = false
      stopping = deps.radio?.stop()
    } else {
      stopping = undefined
    }
    resetToIdle()
    if (drawerAdded) {
      drawerAdded = false
      deps.ui.removeStationDrawer?.(drawerKey)
    }
    return stopping
  }

  const onRadioState = (expectedGeneration: number, state: RadioPlaybackState, reason?: string): void => {
    if (closed || expectedGeneration !== generation) return
    if (state === 'error') {
      resetToIdle({ kind: 'playback-failed', reason: reason ?? 'unknown error' })
      return
    }
    deps.ui.setConnectionIndicator(isConnectingState(state))
    if (state === 'playing') {
      deps.ui.hideBalloon()
      deps.ui.showNotes()
      return
    }
    deps.ui.hideNotes()
  }

  const select = async (value: string): AsyncResult<void, RadioError> => {
    if (closed) return ok(undefined)
    const parsed = parseRadioSelection(value, deps.stations)
    if (isErr(parsed)) return parsed

    const selection = parsed.value
    const nextGeneration = ++generation
    selectedValue = value
    deps.ui.setConnectionIndicator(false)
    if (hasActivePlayback) {
      hasActivePlayback = false
      void Promise.resolve(deps.radio?.stop()).catch(() => {})
    }
    deps.ui.hideNotes()
    deps.ui.hideBalloon()

    if (selection.kind === 'off') {
      deps.ui.setFaceMotionEnabled(true)
      return ok(undefined)
    }

    const radioPort = ensure(deps.radio, (): RadioError => ({ kind: 'radio-unsupported' }))
    if (isErr(radioPort)) {
      resetToIdle(radioPort.error)
      return radioPort
    }

    deps.ui.setFaceMotionEnabled(false)
    hasActivePlayback = true
    const started = await radioPort.value.start({
      url: selection.station.url,
      sampleRate,
      reconnect: true,
      onStateChanged: (state, reason) => onRadioState(nextGeneration, state, reason),
    })

    if (closed || nextGeneration !== generation) return ok(undefined)
    if (isErr(started)) {
      hasActivePlayback = false
      resetToIdle(started.error)
      return started
    }
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
        deps.ui.showBalloon(formatRadioError(error))
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
