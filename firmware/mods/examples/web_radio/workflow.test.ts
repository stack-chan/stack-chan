import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { Result } from 'stackchan-result'
import type { RadioError, RadioPlaybackState, Station } from './domain.js'
import type { NetworkStatus, RadioNetworkPort, RadioPlaybackPort, RadioUiPort, RadioWorkflowDeps } from './workflow.js'

type WorkflowModule = typeof import('./workflow.js')

const TEST_STATIONS: readonly Station[] = [
  { value: 'groovesalad', label: 'Groove Salad', url: 'http://example.test/groovesalad' },
  { value: 'dronezone', label: 'Drone Zone', url: 'http://example.test/dronezone' },
]

function linkPackage(root: string, name: string, target: string): void {
  const pkgDir = resolve(root, 'node_modules', name)
  mkdirSync(pkgDir, { recursive: true })
  const rel = relative(pkgDir, target).replaceAll('\\', '/')
  writeFileSync(`${pkgDir}/index.js`, `export * from ${JSON.stringify(rel.startsWith('.') ? rel : `./${rel}`)};\n`)
  writeFileSync(`${pkgDir}/package.json`, JSON.stringify({ type: 'module', exports: './index.js' }))
}

function installAliases(): void {
  const distRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
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
  const { createRadioApp } = (await import('./workflow.js')) as WorkflowModule
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
  const { createRadioApp } = (await import('./workflow.js')) as WorkflowModule
  const recorder = createUiRecorder()
  let stopCount = 0

  const app = createRadioApp({
    stations: TEST_STATIONS,
    network: {
      waitReady: async () => ok<NetworkStatus>({ status: 'failed', reason: 'timeout' }),
    },
    radio: {
      async start() {
        return ok(undefined)
      },
      stop() {
        stopCount += 1
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

  await app.stop()
  assert.equal(stopCount, 0, 'stopping after network failure must not stop an unstarted shared player')
})

test('web_radio reports radio-unsupported when audio.webRadio is missing and keeps face motion enabled', async () => {
  installAliases()
  const { createRadioApp } = (await import('./workflow.js')) as WorkflowModule
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
  const { createRadioApp } = (await import('./workflow.js')) as WorkflowModule
  const recorder = createUiRecorder()
  let stopCount = 0
  let stateCallback: ((state: RadioPlaybackState, reason?: string) => void) | undefined

  const radio: RadioPlaybackPort = {
    async start(options) {
      stateCallback = options.onStateChanged
      return ok(undefined)
    },
    stop() {
      stopCount += 1
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
  const { createRadioApp } = (await import('./workflow.js')) as WorkflowModule
  const recorder = createUiRecorder()
  let shouldFailStart = true
  let stateCallback: ((state: RadioPlaybackState, reason?: string) => void) | undefined

  const radio: RadioPlaybackPort = {
    async start(options) {
      stateCallback = options.onStateChanged
      if (shouldFailStart) {
        return err({ kind: 'playback-failed', reason: 'connect refused' })
      }
      return ok(undefined)
    },
    stop() {},
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

test('web_radio suppresses stale generation state callbacks and late start failures', async () => {
  installAliases()
  const { createRadioApp } = (await import('./workflow.js')) as WorkflowModule
  const recorder = createUiRecorder()
  const starts: Array<{
    url: string
    deferred: Deferred<Result<void, RadioError>>
    onStateChanged: (state: RadioPlaybackState, reason?: string) => void
  }> = []

  const deps: RadioWorkflowDeps = {
    stations: TEST_STATIONS,
    network: connectedNetwork(),
    radio: {
      start(options) {
        const deferred = createDeferred<Result<void, RadioError>>()
        starts.push({ url: options.url, deferred, onStateChanged: options.onStateChanged })
        return deferred.promise
      },
      stop() {},
    },
    ui: recorder.ui,
  }

  const app = createRadioApp(deps)
  const firstSelect = app.select('groovesalad')
  assert.equal(starts.length, 1)

  const secondSelect = app.select('dronezone')
  assert.equal(starts.length, 2)

  starts[1].deferred.resolve(ok(undefined))
  await secondSelect
  starts[1].onStateChanged('playing')
  assert.equal(recorder.state.notesVisible, true)
  assert.equal(recorder.state.faceMotionEnabled, false)
  assert.equal(recorder.state.balloon, undefined)

  starts[0].onStateChanged('error', 'stale socket reset')
  starts[0].deferred.resolve(err({ kind: 'playback-failed', reason: 'stale connect failure' }))
  const firstResult = await firstSelect
  assert.equal(isOk(firstResult), true)

  assert.equal(recorder.state.notesVisible, true)
  assert.equal(recorder.state.faceMotionEnabled, false)
  assert.equal(recorder.state.balloon, undefined)
})

test('web_radio cleanup stops playback, awaits async stop teardown, restores UI, removes drawer, and blocks stale callbacks', async () => {
  installAliases()
  const { createRadioApp } = (await import('./workflow.js')) as WorkflowModule
  const recorder = createUiRecorder()
  let stopCount = 0
  let stopFinished = false
  let stateCallback: ((state: RadioPlaybackState, reason?: string) => void) | undefined

  const app = createRadioApp({
    stations: TEST_STATIONS,
    network: connectedNetwork(),
    radio: {
      async start(options) {
        stateCallback = options.onStateChanged
        return ok(undefined)
      },
      async stop() {
        stopCount += 1
        await Promise.resolve()
        stopFinished = true
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
  stopFinished = false

  await started.value()
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
