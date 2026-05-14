import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  clientPointFromTouch,
  createHostButtonBridge,
  createHostCameraBridge,
  createHostDriverBridge,
  summarizeImageData,
} from './bridge.mjs'

describe('Host.Button bridge', () => {
  it('exposes constructible active-low buttons sharing state with HTML pushes', () => {
    const scheduled = []
    const events = []
    const bridge = createHostButtonBridge({
      logger: (message) => events.push(message),
      setTimeoutFn: (callback, delay) => {
        scheduled.push({ callback, delay })
        return scheduled.length
      },
    })
    bridge.setHtmlAction('a', () => events.push('html:a'))

    const firmwareButton = new bridge.Button.a({ onPush: () => events.push('firmware:a') })

    assert.equal(firmwareButton.read(), 1)
    bridge.push('a')

    assert.equal(firmwareButton.read(), 0)
    assert.deepEqual(events, ['[bridge] Host.Button.a pushed', 'firmware:a', 'html:a'])
    assert.equal(scheduled[0].delay, 120)

    scheduled[0].callback()
    assert.equal(firmwareButton.read(), 1)
  })

  it('ignores unknown button names without throwing', () => {
    const bridge = createHostButtonBridge({ logger: () => {} })
    assert.doesNotThrow(() => bridge.push('x'))
  })

  it('summarizes sampled image data so blank alpha buffers are visible in diagnostics', () => {
    const stats = summarizeImageData(new Uint8ClampedArray([0, 0, 0, 0, 12, 0, 0, 255]))

    assert.equal(stats.samples, 2)
    assert.equal(stats.nonZeroAlpha, 1)
    assert.equal(stats.nonZeroRgb, 1)
    assert.deepEqual(stats.firstPixel, [0, 0, 0, 0])
  })
})

describe('Host.Driver bridge', () => {
  it('records firmware rotation messages and notifies the simulator scene', () => {
    const events = []
    const bridge = createHostDriverBridge({
      onRotation: (rotation, time) => events.push({ rotation, time }),
      onTorque: (torque) => events.push({ torque }),
    })

    bridge.applyRotation({ rotation: { y: 0.2, p: -0.1, r: 0.03 }, time: 0.5 })
    bridge.setTorque(false)

    assert.deepEqual(bridge.getRotation(), { y: 0.2, p: -0.1, r: 0.03 })
    assert.deepEqual(events, [
      { rotation: { y: 0.2, p: -0.1, r: 0.03 }, time: 0.5 },
      { torque: false },
    ])
  })
})

describe('Host.Camera bridge', () => {
  it('returns deterministic RGB565LE frames sized to capture options', () => {
    const bridge = createHostCameraBridge()

    const first = bridge.capture({ width: 4, height: 3, imageType: 'rgb565le' })
    const second = bridge.capture({ width: 4, height: 3, imageType: 'rgb565le' })

    assert.ok(first)
    assert.ok(second)
    assert.equal(first.width, 4)
    assert.equal(first.height, 3)
    assert.equal(first.imageType, 'rgb565le')
    assert.equal(first.buffer.byteLength, 4 * 3 * 2)
    assert.deepEqual(new Uint8Array(first.buffer), new Uint8Array(second.buffer))
  })

  it('tracks start and stop without requiring browser media devices', () => {
    const bridge = createHostCameraBridge()

    bridge.start({ width: 2, height: 2 })
    assert.equal(bridge.isStarted(), true)

    bridge.stop()
    bridge.stop()
    assert.equal(bridge.isStarted(), false)
  })

  it('keeps unsupported camera formats out of the simulator bridge', () => {
    const bridge = createHostCameraBridge()

    assert.equal(bridge.capture({ imageType: 'jpeg' }), undefined)
    assert.equal('captureJpeg' in bridge, false)
  })
})

describe('touch coordinate bridge', () => {
  it('uses viewport-relative client coordinates for hidden-canvas touch forwarding', () => {
    const point = clientPointFromTouch({ clientX: 42, clientY: 24, pageX: 1042, pageY: 2024 })

    assert.deepEqual(point, { x: 42, y: 24 })
  })
})
