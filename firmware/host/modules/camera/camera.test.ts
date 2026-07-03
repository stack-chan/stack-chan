import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage } from '../testing/node-alias-package.js'
import {
  type CameraCaptureRequest,
  cameraCaptureRequestMatches,
  normalizeCameraCaptureRequest,
} from './device/capture-options.js'
import Camera from './lin/camera.js'

function installBareSpecifierPackages(): void {
  const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  writeAliasPackage(modulesRoot, 'timer', resolve(modulesRoot, 'testing/fakes/timer.js'), { hasDefaultExport: true })
}

test('lin Camera is a safe no-op implementation', async () => {
  const camera = new Camera()

  assert.equal(camera.available, false)
  camera.start({ width: 320, height: 240, imageType: 'rgb565le' })
  assert.equal(await camera.capture(), undefined)
  camera.stop()
})

test('device camera initial frame wait retries after an empty first read', async () => {
  installBareSpecifierPackages()
  const [{ waitForInitialCameraFrame }, timer] = await Promise.all([
    import('./device/initial-frame.js'),
    import('../testing/fakes/timer.js'),
  ])
  timer.default.reset()
  const frame = new ArrayBuffer(4)
  const frames = [undefined, frame]

  const pending = waitForInitialCameraFrame({
    isCurrent: () => true,
    pollMs: 30,
    takeFrame: () => frames.shift(),
    timeoutMs: 500,
  })
  timer.default.advance(30)

  assert.equal(await pending, frame)
})

test('device camera restart check compares requested capture options', () => {
  const defaults: CameraCaptureRequest = { width: 176, height: 144, imageType: 'rgb565le' }
  const current = normalizeCameraCaptureRequest({ width: 200, height: 120, imageType: 'rgb565le' }, defaults)

  assert.equal(cameraCaptureRequestMatches({ width: 200, height: 120, imageType: 'rgb565le' }, current, defaults), true)
  assert.equal(
    cameraCaptureRequestMatches({ width: 240, height: 176, imageType: 'rgb565le' }, current, defaults),
    false,
  )
  assert.equal(cameraCaptureRequestMatches({ width: 200, height: 120, imageType: 'jpeg' }, current, defaults), false)
})

test('device camera initial frame wait times out when no frame arrives', async () => {
  installBareSpecifierPackages()
  const [{ waitForInitialCameraFrame }, timer] = await Promise.all([
    import('./device/initial-frame.js'),
    import('../testing/fakes/timer.js'),
  ])
  timer.default.reset()
  let timedOut = false

  const pending = waitForInitialCameraFrame({
    isCurrent: () => true,
    onTimeout: () => {
      timedOut = true
    },
    pollMs: 30,
    takeFrame: () => undefined,
    timeoutMs: 90,
  })
  timer.default.advance(90)

  assert.equal(await pending, undefined)
  assert.equal(timedOut, true)
})
