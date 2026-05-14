import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  clientPointFromTouch,
  createHostButtonBridge,
  createHostDriverBridge,
  installModArchiveIntoWasm,
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

describe('touch coordinate bridge', () => {
  it('uses viewport-relative client coordinates for hidden-canvas touch forwarding', () => {
    const point = clientPointFromTouch({ clientX: 42, clientY: 24, pageX: 1042, pageY: 2024 })

    assert.deepEqual(point, { x: 42, y: 24 })
  })
})

describe('MOD archive bridge', () => {
  it('reports empty when no archive is installed', () => {
    assert.deepEqual(installModArchiveIntoWasm({}, null), { status: 'empty' })
  })

  it('copies archive bytes into wasm memory, calls the install hook, and frees memory', () => {
    const heap = new Uint8Array(32)
    const calls = []
    const wasmModule = {
      HEAPU8: heap,
      _malloc(size) {
        calls.push(['malloc', size])
        return 8
      },
      _free(pointer) {
        calls.push(['free', pointer])
      },
      _wasmModInstallArchive(pointer, size) {
        calls.push(['hook', pointer, size, Array.from(heap.slice(pointer, pointer + size))])
        return 0
      },
    }

    const result = installModArchiveIntoWasm(wasmModule, {
      name: 'mod.xsa',
      bytes: new Uint8Array([10, 20, 30]),
      size: 3,
    })

    assert.deepEqual(result, {
      status: 'installed',
      hook: '_wasmModInstallArchive',
      name: 'mod.xsa',
      size: 3,
      result: 0,
    })
    assert.deepEqual(calls, [
      ['malloc', 3],
      ['hook', 8, 3, [10, 20, 30]],
      ['free', 8],
    ])
  })

  it('prepares archive bytes as a launch archive when no explicit install hook exists', () => {
    const heap = new Uint8Array(16)
    const calls = []
    const result = installModArchiveIntoWasm(
      {
        HEAPU8: heap,
        _malloc(size) {
          calls.push(['malloc', size])
          return 4
        },
        _free(pointer) {
          calls.push(['free', pointer])
        },
      },
      { name: 'mod.xsa', bytes: new Uint8Array([1, 2]) }
    )

    assert.deepEqual(result, { status: 'prepared', pointer: 4, name: 'mod.xsa', size: 2 })
    assert.deepEqual(Array.from(heap.slice(4, 6)), [1, 2])
    assert.deepEqual(calls, [['malloc', 2]])
  })
})
