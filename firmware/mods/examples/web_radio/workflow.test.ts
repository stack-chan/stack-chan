import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { MediaSession, MediaState } from 'capabilities'
import type { Result } from 'stackchan-result'
import type { RadioError, Station } from './domain.js'
import type { NetworkStatus, RadioNetworkPort, RadioPlaybackPort, RadioUiPort, RadioWorkflowDeps } from './workflow.js'

type RadioPlayback = Pick<MediaSession, 'state' | 'done' | 'stop'>

const TEST_STATIONS: readonly Station[] = [
  { value: 'groovesalad', label: 'Groove Salad', url: 'http://example.test/groovesalad' },
  { value: 'dronezone', label: 'Drone Zone', url: 'http://example.test/dronezone' },
]

function linkPackage(root: string, name: string, target: string, subpath = '.'): void {
  const pkgDir = resolve(root, 'node_modules', name)
  mkdirSync(pkgDir, { recursive: true })
  const rel = relative(pkgDir, target).replaceAll('\\', '/')
  writeFileSync(`${pkgDir}/index.js`, `export * from ${JSON.stringify(rel.startsWith('.') ? rel : `./${rel}`)};\n`)
  writeFileSync(`${pkgDir}/package.json`, JSON.stringify({ type: 'module', exports: { [subpath]: './index.js' } }))
}

function installAliases(): void {
  const distRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
  linkPackage(distRoot, 'stackchan', resolve(distRoot, 'host/modules/voice/scope.js'), './voice/scope')
  linkPackage(distRoot, 'stackchan-result', resolve(distRoot, 'host/modules/util/result.js'))
  linkPackage(distRoot, 'web-radio-domain', resolve(distRoot, 'mods/examples/web_radio/domain.js'))
  linkPackage(distRoot, 'web-radio-workflow', resolve(distRoot, 'mods/examples/web_radio/workflow.js'))
}

installAliases()
const { err, isErr, isOk, ok } = await import('stackchan-result')

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function createPlayback(stop: () => Promise<void> = async () => {}) {
  const completion = createDeferred<'ended' | 'stopped'>()
  const playback: RadioPlayback = {
    state: 'playing',
    done: completion.promise,
    stop,
  }
  return { playback, completion }
}

function createUiRecorder() {
  const events: string[] = []
  let notesVisible = false
  let indicatorVisible = false
  let faceMotionEnabled = true
  let balloon: string | undefined
  let drawerKey: string | undefined
  let onSelect: ((value: string) => void) | undefined

  const ui: RadioUiPort = {
    showNotes() {
      notesVisible = true
      events.push('notes:show')
    },
    hideNotes() {
      notesVisible = false
      events.push('notes:hide')
    },
    setConnectionIndicator(visible) {
      indicatorVisible = visible
      events.push(`indicator:${visible}`)
    },
    setFaceMotionEnabled(enabled) {
      faceMotionEnabled = enabled
      events.push(`faceMotion:${enabled}`)
    },
    showBalloon(text) {
      balloon = text
      events.push(`balloon:show:${text}`)
    },
    hideBalloon() {
      balloon = undefined
      events.push('balloon:hide')
    },
    addStationDrawer(options) {
      drawerKey = options.key
      onSelect = options.onSelect
      events.push(`drawer:add:${options.key}:${options.value}`)
    },
    removeStationDrawer(key) {
      if (drawerKey === key) drawerKey = undefined
      events.push(`drawer:remove:${key}`)
    },
  }

  return {
    ui,
    events,
    get state() {
      return { notesVisible, indicatorVisible, faceMotionEnabled, balloon, drawerKey }
    },
    triggerSelect(value: string) {
      onSelect?.(value)
    },
  }
}

function connectedNetwork(): RadioNetworkPort {
  return {
    waitReady: async () => ok<NetworkStatus>({ status: 'connected' }),
  }
}

test('web_radio reports network-unavailable and skips drawer when network port is absent', async () => {
  installAliases()
  const { createRadioApp } = await import('./workflow.js')
  const recorder = createUiRecorder()

  const app = createRadioApp({
    stations: TEST_STATIONS,
    ui: recorder.ui,
  })

  const result = await app.start()
  assert.equal(isErr(result), true)
  if (isErr(result)) {
    assert.deepEqual(result.error, { kind: 'network-unavailable' })
  }
  assert.equal(recorder.state.balloon, 'Network is not available on this target.')
  assert.equal(recorder.state.drawerKey, undefined)
})

test('web_radio reports network-offline when boot Wi-Fi is not connected', async () => {
  installAliases()
  const { createRadioApp } = await import('./workflow.js')
  const recorder = createUiRecorder()
  let stopCount = 0

  const app = createRadioApp({
    stations: TEST_STATIONS,
    network: {
      waitReady: async () => ok<NetworkStatus>({ status: 'failed', reason: 'timeout' }),
    },
    radio: {
      async open() {
        return ok(
          createPlayback(async () => {
            stopCount += 1
          }).playback,
        )
      },
    },
    ui: recorder.ui,
  })

  const result = await app.start()
  assert.equal(isErr(result), true)
  if (isErr(result)) {
    assert.deepEqual(result.error, { kind: 'network-offline', reason: 'timeout' })
  }
  assert.equal(recorder.state.balloon, 'Network unavailable: timeout')
  assert.equal(recorder.state.drawerKey, undefined)

  recorder.events.length = 0
  await app.stop()
  assert.equal(stopCount, 0, 'stopping after network failure must not stop an unstarted shared player')
  assert.deepEqual(recorder.events, ['balloon:hide'])
})

test('web_radio closing during network readiness leaves other UI untouched', async () => {
  const { createRadioApp } = await import('./workflow.js')
  const recorder = createUiRecorder()
  const readiness = createDeferred<Result<NetworkStatus, RadioError>>()
  const app = createRadioApp({
    stations: TEST_STATIONS,
    network: { waitReady: () => readiness.promise },
    ui: recorder.ui,
  })

  recorder.ui.setConnectionIndicator(true)
  recorder.ui.setFaceMotionEnabled(false)
  recorder.ui.showBalloon('Other activity')
  const beforeStop = recorder.state
  const started = app.start()
  await app.stop()
  readiness.resolve(ok({ status: 'connected' }))
  await started

  assert.deepEqual(recorder.state, beforeStop)
})

test('web_radio reports radio-unsupported when the media capability is missing and keeps face motion enabled', async () => {
  installAliases()
  const { createRadioApp } = await import('./workflow.js')
  const recorder = createUiRecorder()

  const app = createRadioApp({
    stations: TEST_STATIONS,
    network: connectedNetwork(),
    ui: recorder.ui,
  })

  const started = await app.start()
  assert.equal(isOk(started), true)
  assert.equal(recorder.state.drawerKey, 'web-radio:station')
  assert.equal(recorder.state.balloon, 'WebRadio is not supported on this target.')
  assert.equal(recorder.state.faceMotionEnabled, true)

  const selected = await app.select('dronezone')
  assert.equal(isErr(selected), true)
  if (isErr(selected)) {
    assert.deepEqual(selected.error, { kind: 'radio-unsupported' })
  }
})

test('web_radio rejects unknown station without disrupting active playback', async () => {
  installAliases()
  const { createRadioApp } = await import('./workflow.js')
  const recorder = createUiRecorder()
  let stopCount = 0
  let stateCallback: ((state: MediaState, reason?: string) => void) | undefined

  const radio: RadioPlaybackPort = {
    async open(options) {
      stateCallback = options.onStateChanged
      return ok(
        createPlayback(async () => {
          stopCount += 1
        }).playback,
      )
    },
  }

  const app = createRadioApp({
    stations: TEST_STATIONS,
    network: connectedNetwork(),
    radio,
    ui: recorder.ui,
  })

  const started = await app.start()
  assert.equal(isOk(started), true)
  stateCallback?.('playing')
  assert.equal(recorder.state.notesVisible, true)
  const stopsBefore = stopCount

  const unknown = await app.select('does-not-exist')
  assert.equal(isErr(unknown), true)
  if (isErr(unknown)) {
    assert.deepEqual(unknown.error, { kind: 'unknown-station', value: 'does-not-exist' })
  }
  assert.equal(stopCount, stopsBefore)
  assert.equal(recorder.state.notesVisible, true)
})

test('web_radio rolls back UI to idle when playback start or stream state fails', async () => {
  installAliases()
  const { createRadioApp } = await import('./workflow.js')
  const recorder = createUiRecorder()
  let shouldFailStart = true
  let stateCallback: ((state: MediaState, reason?: string) => void) | undefined

  const radio: RadioPlaybackPort = {
    async open(options) {
      stateCallback = options.onStateChanged
      if (shouldFailStart) {
        return err({ kind: 'playback-failed', reason: 'connect refused' })
      }
      return ok(createPlayback().playback)
    },
  }

  const app = createRadioApp({
    stations: TEST_STATIONS,
    network: connectedNetwork(),
    radio,
    ui: recorder.ui,
  })

  await app.start()
  assert.equal(recorder.state.faceMotionEnabled, true)
  assert.equal(recorder.state.notesVisible, false)
  assert.equal(recorder.state.indicatorVisible, false)
  assert.equal(recorder.state.balloon, 'Radio error: connect refused')

  shouldFailStart = false
  const switched = await app.select('dronezone')
  assert.equal(isOk(switched), true)
  stateCallback?.('playing')
  assert.equal(recorder.state.faceMotionEnabled, false)
  assert.equal(recorder.state.notesVisible, true)

  stateCallback?.('error', 'stream dropped')
  assert.equal(recorder.state.faceMotionEnabled, true)
  assert.equal(recorder.state.notesVisible, false)
  assert.equal(recorder.state.indicatorVisible, false)
  assert.equal(recorder.state.balloon, 'Radio error: stream dropped')
})

test('web_radio cancels an opening station before starting the latest selection', async () => {
  const { createRadioApp } = await import('./workflow.js')
  const recorder = createUiRecorder()
  const starts: Array<{
    url: string
    signal: Parameters<RadioPlaybackPort['open']>[0]['signal']
    deferred: Deferred<Result<RadioPlayback, RadioError>>
    onStateChanged: (state: MediaState, reason?: string) => void
  }> = []
  const stopped: string[] = []

  const deps: RadioWorkflowDeps = {
    stations: TEST_STATIONS,
    network: connectedNetwork(),
    radio: {
      open(options) {
        const deferred = createDeferred<Result<RadioPlayback, RadioError>>()
        starts.push({ ...options, deferred })
        return deferred.promise
      },
    },
    ui: recorder.ui,
  }

  const app = createRadioApp(deps)
  const firstSelect = app.select('groovesalad')
  assert.equal(starts.length, 1)
  const superseded = app.select('off')
  const latest = app.select('dronezone')
  assert.equal(starts[0].signal.aborted, true)
  assert.equal(starts.length, 1)

  starts[0].onStateChanged('error', 'stale socket reset')
  starts[0].deferred.resolve(
    ok(
      createPlayback(async () => {
        stopped.push('groovesalad')
      }).playback,
    ),
  )
  await firstSelect
  await superseded
  assert.deepEqual(stopped, ['groovesalad'])
  assert.deepEqual(
    starts.map(({ url }) => url),
    TEST_STATIONS.map(({ url }) => url),
  )

  starts[1].deferred.resolve(ok(createPlayback().playback))
  assert(isOk(await latest))
  starts[1].onStateChanged('playing')
  assert.equal(recorder.state.notesVisible, true)
  assert.equal(recorder.state.faceMotionEnabled, false)
  assert.equal(recorder.state.balloon, undefined)
})

test('web_radio shutdown waits for an opening station to be stopped', async () => {
  const { createRadioApp } = await import('./workflow.js')
  const recorder = createUiRecorder()
  const opening = createDeferred<Result<RadioPlayback, RadioError>>()
  const stopStarted = createDeferred<void>()
  const releaseStop = createDeferred<void>()
  let signal: Parameters<RadioPlaybackPort['open']>[0]['signal'] | undefined
  let stopped = false
  let shutdownFinished = false
  const app = createRadioApp({
    stations: TEST_STATIONS,
    radio: {
      open(options) {
        signal = options.signal
        return opening.promise
      },
    },
    ui: recorder.ui,
  })

  const selecting = app.select('groovesalad')
  const stopping = Promise.resolve(app.stop()).then(() => {
    shutdownFinished = true
  })
  assert.equal(signal?.aborted, true)
  opening.resolve(
    ok(
      createPlayback(async () => {
        stopStarted.resolve(undefined)
        await releaseStop.promise
        stopped = true
      }).playback,
    ),
  )
  await stopStarted.promise
  assert.equal(shutdownFinished, false)
  releaseStop.resolve(undefined)
  await stopping
  assert.equal(stopped, true)
  assert(isOk(await selecting))
  assert.equal(recorder.state.faceMotionEnabled, true)
})

test('web_radio retires a station when a synchronous opening callback closes the app', async () => {
  const { createRadioApp } = await import('./workflow.js')
  const recorder = createUiRecorder()
  const opening = createDeferred<Result<RadioPlayback, RadioError>>()
  const stopStarted = createDeferred<void>()
  const releaseStop = createDeferred<void>()
  let openingSignal: Parameters<RadioPlaybackPort['open']>[0]['signal'] | undefined
  let shutdown: Promise<void> | undefined
  let shutdownFinished = false
  let stopCount = 0
  const app = createRadioApp({
    stations: TEST_STATIONS,
    radio: {
      open({ signal, onStateChanged }) {
        openingSignal = signal
        onStateChanged('playing')
        return opening.promise
      },
    },
    ui: {
      ...recorder.ui,
      showNotes() {
        recorder.ui.showNotes()
        shutdown = Promise.resolve(app.stop()).then(() => {
          shutdownFinished = true
        })
      },
    },
  })

  const selecting = app.select('groovesalad')
  assert.equal(openingSignal?.aborted, true)
  opening.resolve(
    ok(
      createPlayback(async () => {
        stopCount += 1
        stopStarted.resolve(undefined)
        await releaseStop.promise
      }).playback,
    ),
  )
  await stopStarted.promise
  assert.equal(shutdownFinished, false)
  releaseStop.resolve(undefined)
  await shutdown
  assert(isOk(await selecting))
  assert.equal(stopCount, 1)
  assert.equal(recorder.state.notesVisible, false)
  assert.equal(recorder.state.faceMotionEnabled, true)
})

test('web_radio cleanup leaves a replacement media session running', async () => {
  const { createRadioApp } = await import('./workflow.js')
  const recorder = createUiRecorder()
  let currentSession = ''
  const stopped: string[] = []
  const radio = createPlayback(async () => {
    stopped.push('radio')
    if (currentSession === 'radio') currentSession = ''
  })
  const app = createRadioApp({
    stations: TEST_STATIONS,
    network: connectedNetwork(),
    radio: {
      async open({ onStateChanged }) {
        currentSession = 'radio'
        onStateChanged('playing')
        return ok(radio.playback)
      },
    },
    ui: recorder.ui,
  })

  assert(isOk(await app.start()))
  stopped.push('radio')
  radio.completion.resolve('stopped')
  currentSession = 'podcast'
  await Promise.resolve()
  assert.equal(recorder.state.faceMotionEnabled, true)
  await app.stop()
  assert.equal(currentSession, 'podcast')
  assert.deepEqual(stopped, ['radio'])
})

test('web_radio cleanup stops playback, awaits async stop teardown, restores UI, removes drawer, and blocks stale callbacks', async () => {
  installAliases()
  const { createRadioApp } = await import('./workflow.js')
  const recorder = createUiRecorder()
  const stopStarted = createDeferred<void>()
  const releaseStop = createDeferred<void>()
  let stopCount = 0
  let stopFinished = false
  let shutdownFinished = false
  let stateCallback: ((state: MediaState, reason?: string) => void) | undefined

  const app = createRadioApp({
    stations: TEST_STATIONS,
    network: connectedNetwork(),
    radio: {
      async open(options) {
        stateCallback = options.onStateChanged
        return ok(
          createPlayback(async () => {
            stopCount += 1
            stopStarted.resolve(undefined)
            await releaseStop.promise
            stopFinished = true
          }).playback,
        )
      },
    },
    ui: recorder.ui,
  })

  const started = await app.start()
  assert.equal(isOk(started), true)
  if (!isOk(started)) return
  stateCallback?.('playing')
  assert.equal(recorder.state.notesVisible, true)
  assert.equal(recorder.state.drawerKey, 'web-radio:station')
  const stopsBeforeCleanup = stopCount

  const stopping = Promise.resolve(started.value()).then(() => {
    shutdownFinished = true
  })
  await stopStarted.promise
  assert.equal(shutdownFinished, false)
  releaseStop.resolve(undefined)
  await stopping
  await started.value()

  assert.equal(stopCount, stopsBeforeCleanup + 1)
  assert.equal(stopFinished, true)
  assert.equal(recorder.state.notesVisible, false)
  assert.equal(recorder.state.indicatorVisible, false)
  assert.equal(recorder.state.faceMotionEnabled, true)
  assert.equal(recorder.state.balloon, undefined)
  assert.equal(recorder.state.drawerKey, undefined)

  stateCallback?.('playing')
  stateCallback?.('error', 'late close error')
  assert.equal(recorder.state.notesVisible, false)
  assert.equal(recorder.state.balloon, undefined)
})
