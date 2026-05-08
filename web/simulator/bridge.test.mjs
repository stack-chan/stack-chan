import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  clientPointFromTouch,
  createHostAudioInBridge,
  createHostAudioOutBridge,
  createHostButtonBridge,
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

describe('Host.Audio bridge', () => {
  it('resolves tone playback only after the oscillator ends and closes the context', async () => {
    const events = []
    let oscillator
    const context = {
      currentTime: 2,
      closed: false,
      createOscillator() {
        oscillator = {
          frequency: { value: 0 },
          onended: undefined,
          connect(node) {
            events.push(['osc-connect', node.kind])
          },
          start(time) {
            events.push(['start', time, this.frequency.value])
          },
          stop(time) {
            events.push(['stop', time])
          },
        }
        return oscillator
      },
      createGain() {
        return {
          kind: 'gain',
          gain: { value: 0 },
          connect(node) {
            events.push(['gain-connect', node])
          },
        }
      },
      destination: 'destination',
      close() {
        this.closed = true
        events.push(['close'])
      },
    }
    const bridge = createHostAudioOutBridge({ createAudioContext: () => context })

    let resolved = false
    const tone = bridge.tone({ hz: 880, duration: 500, volume: 0.25 }).then(() => {
      resolved = true
    })

    await Promise.resolve()
    assert.equal(resolved, false)
    oscillator.onended()
    await tone
    bridge.close()

    assert.deepEqual(events, [
      ['osc-connect', 'gain'],
      ['gain-connect', 'destination'],
      ['start', 2, 880],
      ['stop', 2.5],
      ['close'],
    ])
    assert.equal(context.closed, true)
  })

  it('records only WAV-compatible microphone audio through getUserMedia and stops tracks', async () => {
    const stopped = []
    const recorderOptions = []
    const wavHeader = new TextEncoder().encode('RIFFxxxxWAVE')
    class FakeMediaRecorder {
      static isTypeSupported(type) {
        return type === 'audio/wav'
      }

      constructor(stream, options) {
        this.stream = stream
        recorderOptions.push(options)
      }
      start() {
        this.ondataavailable?.({ data: wavHeader.buffer })
      }
      stop() {
        this.onstop?.()
      }
    }
    const bridge = createHostAudioInBridge({
      mediaDevices: {
        async getUserMedia(request) {
          assert.deepEqual(request, { audio: true })
          return { getTracks: () => [{ stop: () => stopped.push('track') }] }
        },
      },
      MediaRecorder: FakeMediaRecorder,
      setTimeoutFn(fn) {
        fn()
      },
    })

    const buffer = await bridge.record(100)

    assert.equal(new TextDecoder().decode(buffer.slice(0, 4)), 'RIFF')
    assert.equal(new TextDecoder().decode(buffer.slice(8, 12)), 'WAVE')
    assert.deepEqual(recorderOptions, [{ mimeType: 'audio/wav' }])
    assert.deepEqual(stopped, ['track'])
  })

  it('returns an empty microphone buffer instead of WebM/Opus when WAV recording is unavailable', async () => {
    let requested = false
    class FakeMediaRecorder {
      static isTypeSupported() {
        return false
      }
    }
    const bridge = createHostAudioInBridge({
      mediaDevices: {
        async getUserMedia() {
          requested = true
          throw new Error('should not request microphone without WAV support')
        },
      },
      MediaRecorder: FakeMediaRecorder,
    })

    const buffer = await bridge.record(100)

    assert.equal(buffer.byteLength, 0)
    assert.equal(requested, false)
  })
})

describe('touch coordinate bridge', () => {
  it('uses viewport-relative client coordinates for hidden-canvas touch forwarding', () => {
    const point = clientPointFromTouch({ clientX: 42, clientY: 24, pageX: 1042, pageY: 2024 })

    assert.deepEqual(point, { x: 42, y: 24 })
  })
})
