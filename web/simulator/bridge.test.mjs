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
    assert.deepEqual(events, [{ rotation: { y: 0.2, p: -0.1, r: 0.03 }, time: 0.5 }, { torque: false }])
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

  it('tracks start and stop without requiring browser media devices', async () => {
    const bridge = createHostCameraBridge()

    await bridge.start({ width: 2, height: 2 })
    assert.equal(bridge.isStarted(), true)

    bridge.stop()
    bridge.stop()
    assert.equal(bridge.isStarted(), false)
  })

  it('captures ready browser video frames as RGB565LE through canvas', async () => {
    const calls = []
    const stream = { getTracks: () => [{ stop: () => calls.push('stop') }] }
    const video = {
      readyState: 2,
      videoWidth: 16,
      videoHeight: 16,
      play: async () => calls.push('play'),
    }
    const canvas = {
      getContext: () => ({
        drawImage: (...args) => calls.push(['drawImage', ...args.slice(1)]),
        getImageData: () => ({
          data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]),
        }),
      }),
    }
    const bridge = createHostCameraBridge({
      canvasElement: canvas,
      navigatorObj: {
        mediaDevices: {
          async getUserMedia(constraints) {
            calls.push(['getUserMedia', constraints])
            return stream
          },
        },
      },
      videoElement: video,
    })

    await bridge.start({ useBrowserCamera: true })
    const frame = bridge.capture({ width: 2, height: 2, imageType: 'rgb565le' })

    assert.equal(bridge.isStarted(), true)
    assert.equal(bridge.isBrowserCameraStarted(), true)
    assert.deepEqual(calls.slice(0, 3), [['getUserMedia', { video: true }], 'play', ['drawImage', 0, 0, 2, 2]])
    assert.equal(video.srcObject, stream)
    assert.equal(canvas.width, 2)
    assert.equal(canvas.height, 2)
    assert.equal(frame.width, 2)
    assert.equal(frame.height, 2)
    assert.equal(frame.imageType, 'rgb565le')
    assert.equal(frame.buffer.byteLength, 2 * 2 * 2)
    assert.deepEqual(new Uint8Array(frame.buffer), new Uint8Array([0x00, 0xf8, 0xe0, 0x07, 0x1f, 0x00, 0xff, 0xff]))

    bridge.stop()
    assert.equal(video.srcObject, null)
    assert.equal(calls.at(-1), 'stop')
  })

  it('falls back to synthetic RGB565LE when browser media APIs are absent', async () => {
    const bridge = createHostCameraBridge({ navigatorObj: {}, documentObj: undefined })

    await bridge.start({ useBrowserCamera: true })
    const first = bridge.capture({ width: 2, height: 2, imageType: 'rgb565le' })
    const second = createHostCameraBridge().capture({ width: 2, height: 2, imageType: 'rgb565le' })

    assert.equal(bridge.isBrowserCameraStarted(), false)
    assert.deepEqual(new Uint8Array(first.buffer), new Uint8Array(second.buffer))
  })

  it('falls back to synthetic RGB565LE when browser permission is denied', async () => {
    const warnings = []
    const bridge = createHostCameraBridge({
      logger: { warn: (...args) => warnings.push(args) },
      navigatorObj: {
        mediaDevices: {
          async getUserMedia() {
            throw new Error('denied')
          },
        },
      },
      videoElement: { srcObject: undefined },
    })

    await assert.doesNotReject(() => bridge.start({ useBrowserCamera: true }))
    const frame = bridge.capture({ width: 2, height: 2, imageType: 'rgb565le' })

    assert.equal(bridge.isBrowserCameraStarted(), false)
    assert.equal(frame.buffer.byteLength, 2 * 2 * 2)
    assert.match(warnings[0][0], /browser camera unavailable/)
  })

  it('falls back to synthetic RGB565LE when browser video is not ready', async () => {
    const bridge = createHostCameraBridge({
      canvasElement: {
        getContext: () => {
          throw new Error('canvas should not be read before video is ready')
        },
      },
      navigatorObj: {
        mediaDevices: {
          async getUserMedia() {
            return { getTracks: () => [] }
          },
        },
      },
      videoElement: { readyState: 1, videoWidth: 0, videoHeight: 0 },
    })

    await bridge.start({ useBrowserCamera: true })
    const first = bridge.capture({ width: 2, height: 2, imageType: 'rgb565le' })
    const second = createHostCameraBridge().capture({ width: 2, height: 2, imageType: 'rgb565le' })

    assert.equal(bridge.isBrowserCameraStarted(), true)
    assert.deepEqual(new Uint8Array(first.buffer), new Uint8Array(second.buffer))
  })

  it('stops late-resolving browser streams when camera was stopped during permission prompt', async () => {
    let resolveStream
    const stopped = []
    const stream = { getTracks: () => [{ stop: () => stopped.push('stop') }] }
    const video = { srcObject: undefined, play: async () => {} }
    const bridge = createHostCameraBridge({
      navigatorObj: {
        mediaDevices: {
          getUserMedia() {
            return new Promise((resolve) => {
              resolveStream = resolve
            })
          },
        },
      },
      videoElement: video,
    })

    const startPromise = bridge.start({ useBrowserCamera: true })
    bridge.stop()
    resolveStream(stream)
    await startPromise

    assert.equal(bridge.isStarted(), false)
    assert.equal(bridge.isBrowserCameraStarted(), false)
    assert.equal(video.srcObject, null)
    assert.deepEqual(stopped, ['stop'])
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
