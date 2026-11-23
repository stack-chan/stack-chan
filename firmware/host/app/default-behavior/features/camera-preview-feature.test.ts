import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { ModScope } from 'mod-kit'
import FakeTimer from '../../../modules/testing/fakes/timer.js'
import { writeAliasPackage } from '../../../modules/testing/node-alias-package.js'
import { isOk } from '../../../modules/util/result.js'
import type { CameraPreviewCameraPort, CameraPreviewCapturedFrame } from './camera-preview-feature.js'

const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
writeAliasPackage(hostRoot, 'stackchan-result', resolve(hostRoot, 'modules/util/result.js'))
writeAliasPackage(hostRoot, 'timer', resolve(hostRoot, 'modules/testing/fakes/timer.js'), { hasDefaultExport: true })

const { installCameraPreviewFeature } = await import('./camera-preview-feature.js')

const flushMicrotasks = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

function createFixture(camera: CameraPreviewCameraPort, replaceDuringSetMain = false) {
  const cleanups: Parameters<ModScope['own']>[0][] = []
  const clearedDelays: number[] = []
  const scheduledDelays: number[] = []
  let triggerPreview: (() => Promise<void>) | undefined
  let shownScreens = 0
  let shownFaces = 0
  let screen: 'face' | 'preview' | 'successor' = 'face'
  let closePreview: (() => void) | undefined
  let dismissPreview: (() => void) | undefined

  function replacePreview() {
    screen = 'successor'
    closePreview?.()
  }

  FakeTimer.reset()
  const installed = installCameraPreviewFeature(
    {
      camera,
      captureImageType: 'rgb565le',
      prepareFrame: () => ({ width: 200, height: 120, imageType: 'rgb565le' }),
      createDialog(preview, { onDismiss }) {
        dismissPreview = onDismiss
        return preview
      },
      setMain(_preview, options) {
        if (screen === 'preview') replacePreview()
        shownScreens += 1
        screen = 'preview'
        const close = () => {
          if (closePreview !== close) return
          closePreview = undefined
          if (screen === 'preview') {
            screen = 'face'
            shownFaces += 1
          }
          options?.onClose?.()
        }
        closePreview = close
        if (replaceDuringSetMain) replacePreview()
        return close
      },
      closeDrawer() {},
      showBalloon() {},
      hideBalloon() {},
      hideBalloonLater() {},
      localize: (key) => key,
      addDrawerButton(button) {
        triggerPreview = button.callback
      },
      timer: {
        set(callback, interval) {
          scheduledDelays.push(interval)
          const handle = FakeTimer.set(callback, interval)
          return () => {
            clearedDelays.push(interval)
            FakeTimer.clear(handle)
          }
        },
        clear(cancel) {
          if (typeof cancel === 'function') cancel()
        },
      },
      log() {},
    },
    {
      own(cleanup) {
        cleanups.unshift(cleanup)
      },
    },
  )
  assert.ok(isOk(installed))

  return {
    trigger() {
      assert.ok(triggerPreview)
      return triggerPreview()
    },
    async close() {
      for (const cleanup of cleanups.splice(0)) {
        await cleanup()
      }
    },
    clearedDelays,
    scheduledDelays,
    replacePreview,
    dismissPreview() {
      dismissPreview?.()
    },
    get screen() {
      return screen
    },
    get shownScreens() {
      return shownScreens
    },
    get shownFaces() {
      return shownFaces
    },
  }
}

test('a preview replaced during setMain leaves the successor visible after its restore deadline', async () => {
  const fixture = createFixture(
    {
      start() {},
      async capture() {
        return {}
      },
      stop() {},
    },
    true,
  )

  const preview = fixture.trigger()
  await flushMicrotasks()
  FakeTimer.advance(120)
  await preview

  assert.equal(fixture.screen, 'successor')
  assert.deepEqual(fixture.scheduledDelays, [120])
  FakeTimer.advance(5000)
  assert.equal(fixture.screen, 'successor')
  await fixture.close()
  assert.equal(fixture.screen, 'successor')
})

test('dismissal of an already replaced preview leaves the successor visible', async () => {
  const fixture = createFixture({
    start() {},
    async capture() {
      return {}
    },
    stop() {},
  })

  const preview = fixture.trigger()
  await flushMicrotasks()
  fixture.replacePreview()
  fixture.dismissPreview()
  assert.equal(fixture.screen, 'successor')
  FakeTimer.advance(6000)
  await preview
  await fixture.close()
  assert.equal(fixture.screen, 'successor')
})

test('dismiss and restore timeout both close an active preview', async () => {
  const fixture = createFixture({
    start() {},
    async capture() {
      return {}
    },
    stop() {},
  })

  const firstPreview = fixture.trigger()
  await flushMicrotasks()
  assert.equal(fixture.screen, 'preview')
  fixture.dismissPreview()
  assert.equal(fixture.screen, 'face')
  FakeTimer.advance(120)
  await firstPreview

  const secondPreview = fixture.trigger()
  await flushMicrotasks()
  assert.equal(fixture.screen, 'preview')
  FakeTimer.advance(5000)
  await secondPreview
  assert.equal(fixture.screen, 'face')
  await fixture.close()
})

test('uses the CoreS3 camera native capture mode while rendering a preview', async () => {
  const requests: Parameters<CameraPreviewCameraPort['start']>[0][] = []
  const fixture = createFixture({
    start(options) {
      requests.push(options)
    },
    async capture(options) {
      requests.push(options)
      return {}
    },
    stop() {},
  })

  const preview = fixture.trigger()
  await flushMicrotasks()
  const qqvga = { width: 160, height: 120, imageType: 'rgb565le' }
  assert.deepEqual(requests, [qqvga, qqvga])
  assert.equal(fixture.shownScreens, 1)
  FakeTimer.advance(120)
  await preview
  await fixture.close()
})

test('ignores another drawer selection until the pending capture and its stop finish', async () => {
  const frame = deferred<CameraPreviewCapturedFrame>()
  const calls: string[] = []
  const fixture = createFixture({
    start() {
      calls.push('start')
    },
    capture() {
      calls.push('capture')
      return frame.promise
    },
    stop() {
      calls.push('stop')
    },
  })

  const preview = fixture.trigger()
  await flushMicrotasks()
  void fixture.trigger()
  await flushMicrotasks()
  assert.deepEqual(calls, ['start', 'capture'])

  frame.resolve({})
  await flushMicrotasks()
  void fixture.trigger()
  await flushMicrotasks()
  assert.deepEqual(calls, ['start', 'capture'])
  FakeTimer.advance(120)
  await preview
  assert.deepEqual(calls, ['start', 'capture', 'stop'])

  const nextPreview = fixture.trigger()
  await flushMicrotasks()
  FakeTimer.advance(120)
  await nextPreview
  assert.deepEqual(calls, ['start', 'capture', 'stop', 'start', 'capture', 'stop'])
  await fixture.close()
})

test('attempts camera stop even when releasing the frame throws', async () => {
  const calls: string[] = []
  const fixture = createFixture({
    start() {},
    async capture() {
      return {
        close() {
          calls.push('frame.close')
          throw new Error('frame release failed')
        },
      }
    },
    stop() {
      calls.push('stop')
    },
  })

  const preview = fixture.trigger().catch(() => {})
  await flushMicrotasks()
  assert.deepEqual(calls, ['frame.close'])
  FakeTimer.advance(120)
  await preview
  assert.deepEqual(calls, ['frame.close', 'stop'])
  await fixture.close()
})

test('closing during the paint delay clears both timers and awaits the immediate stop', async () => {
  const stop = deferred<void>()
  const calls: string[] = []
  const fixture = createFixture({
    start() {},
    async capture() {
      return {
        close() {
          calls.push('frame.close')
        },
      }
    },
    stop() {
      calls.push('stop')
      return stop.promise
    },
  })

  const preview = fixture.trigger()
  await flushMicrotasks()
  assert.equal(fixture.shownScreens, 1)
  assert.deepEqual(calls, ['frame.close'])

  let closed = false
  const close = fixture.close().then(() => {
    closed = true
  })
  await flushMicrotasks()
  assert.deepEqual(calls, ['frame.close', 'stop'])
  assert.deepEqual(fixture.clearedDelays, [5000, 120])
  assert.equal(closed, false)
  FakeTimer.advance(6000)
  assert.equal(fixture.screen, 'face')
  assert.equal(fixture.shownFaces, 1)
  stop.resolve(undefined)
  await Promise.all([preview, close])
  assert.deepEqual(calls, ['frame.close', 'stop'])
})

test('a camera start that settles after scope close is stopped without capturing', async () => {
  const start = deferred<void>()
  const calls: string[] = []
  const fixture = createFixture({
    start() {
      calls.push('start')
      return start.promise
    },
    async capture() {
      calls.push('capture')
      return {}
    },
    stop() {
      calls.push('stop')
    },
  })

  const preview = fixture.trigger()
  await flushMicrotasks()
  const close = fixture.close()
  await flushMicrotasks()
  assert.deepEqual(calls, ['start'])
  start.resolve(undefined)
  await Promise.all([preview, close])
  assert.deepEqual(calls, ['start', 'stop'])
  assert.equal(fixture.shownScreens, 0)
})

test('a frame that arrives after scope close is released before camera shutdown', async () => {
  const frame = deferred<CameraPreviewCapturedFrame>()
  const calls: string[] = []
  const fixture = createFixture({
    start() {},
    capture() {
      calls.push('capture')
      return frame.promise
    },
    stop() {
      calls.push('stop')
    },
  })

  const preview = fixture.trigger()
  await flushMicrotasks()
  const close = fixture.close()
  await flushMicrotasks()
  assert.deepEqual(calls, ['capture'])
  frame.resolve({
    close() {
      calls.push('frame.close')
    },
  })
  await Promise.all([preview, close])
  assert.deepEqual(calls, ['capture', 'frame.close', 'stop'])
  assert.equal(fixture.shownScreens, 0)
})
