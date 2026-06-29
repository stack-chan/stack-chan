import assert from 'node:assert/strict'
import { test } from 'node:test'

import Camera from './camera.js'

test('default Camera is a safe no-op implementation', async () => {
  const camera = new Camera()

  camera.start({ width: 320, height: 240, imageType: 'rgb565le' })
  assert.equal(await camera.capture(), undefined)
  camera.stop()
})
