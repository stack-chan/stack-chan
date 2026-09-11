import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { CameraCaptureOptions, CameraFrame, RobotCamera } from '../../modules/camera/camera.js'
import { installRuntimeTestAliases } from './runtime-test-aliases.js'

installRuntimeTestAliases()
const { StackchanRuntimeCamera } = await import('../runtime-camera.js')

function frame(width = 1, height = 1): CameraFrame {
  return {
    width,
    height,
    imageType: 'rgb565le',
    buffer: new ArrayBuffer(width * height * 2),
  }
}

test('StackchanRuntimeCamera pauses touchPanel for an explicit camera session', async () => {
  const events: unknown[] = []
  const camera: RobotCamera = {
    available: true,
    start(options?: CameraCaptureOptions) {
      events.push(['camera.start', options])
    },
    stop() {
      events.push(['camera.stop'])
    },
    async capture(options?: CameraCaptureOptions) {
      events.push(['camera.capture', options])
      return frame(2, 2)
    },
  }
  const touchPanel = {
    stop() {
      events.push(['touch.stop'])
    },
    start() {
      events.push(['touch.start'])
    },
  }

  const runtime = new StackchanRuntimeCamera({ camera, touchPanel })
  await runtime.camera.start({ width: 2, height: 2, imageType: 'rgb565le' })
  const captured = await runtime.camera.capture({ width: 2, height: 2, imageType: 'rgb565le' })
  await runtime.camera.stop()

  assert.equal(runtime.camera.available, true)
  assert.equal(captured?.buffer.byteLength, 8)
  assert.deepEqual(events, [
    ['touch.stop'],
    ['camera.start', { width: 2, height: 2, imageType: 'rgb565le' }],
    ['camera.capture', { width: 2, height: 2, imageType: 'rgb565le' }],
    ['camera.stop'],
    ['touch.start'],
  ])
})

test('StackchanRuntimeCamera completes synchronous stop without adding a promise turn', () => {
  const events: string[] = []
  const camera: RobotCamera = {
    start() {
      events.push('camera.start')
    },
    stop() {
      events.push('camera.stop')
    },
    async capture() {
      events.push('camera.capture')
      return frame()
    },
  }
  const touchPanel = {
    stop() {
      events.push('touch.stop')
    },
    start() {
      events.push('touch.start')
    },
  }

  const runtime = new StackchanRuntimeCamera({ camera, touchPanel })

  runtime.camera.start()
  const result = runtime.camera.stop()

  assert.equal(result, undefined)
  assert.deepEqual(events, ['touch.stop', 'camera.start', 'camera.stop', 'touch.start'])
})

test('StackchanRuntimeCamera waits for asynchronous stop before resuming touchPanel', async () => {
  const events: string[] = []
  let resolveStop: (() => void) | undefined
  const camera: RobotCamera = {
    start() {
      events.push('camera.start')
    },
    stop() {
      events.push('camera.stop')
      return new Promise<void>((resolve) => {
        resolveStop = resolve
      })
    },
    async capture() {
      events.push('camera.capture')
      return frame()
    },
  }
  const touchPanel = {
    stop() {
      events.push('touch.stop')
    },
    start() {
      events.push('touch.start')
    },
  }

  const runtime = new StackchanRuntimeCamera({ camera, touchPanel })

  runtime.camera.start()
  const pending = runtime.camera.stop()
  assert.deepEqual(events, ['touch.stop', 'camera.start', 'camera.stop'])

  resolveStop?.()
  await pending

  assert.deepEqual(events, ['touch.stop', 'camera.start', 'camera.stop', 'touch.start'])
})

test('StackchanRuntimeCamera close releases the camera without resuming touchPanel', async () => {
  const events: string[] = []
  const camera: RobotCamera = {
    start() {
      events.push('camera.start')
    },
    stop() {
      events.push('camera.stop')
    },
    close() {
      events.push('camera.close')
    },
    async capture() {
      events.push('camera.capture')
      return frame()
    },
  }
  const touchPanel = {
    stop() {
      events.push('touch.stop')
    },
    start() {
      events.push('touch.start')
    },
  }

  const runtime = new StackchanRuntimeCamera({ camera, touchPanel })

  runtime.camera.start()
  const result = runtime.close()

  assert.equal(result, runtime.close())
  await result
  assert.deepEqual(events, ['touch.stop', 'camera.start', 'camera.stop', 'camera.close'])
})

test('StackchanRuntimeCamera brackets direct capture calls with touchPanel pause and resume', async () => {
  const events: string[] = []
  const camera: RobotCamera = {
    start() {
      events.push('camera.start')
    },
    stop() {
      events.push('camera.stop')
    },
    async capture() {
      events.push('camera.capture')
      return frame()
    },
  }
  const touchPanel = {
    stop() {
      events.push('touch.stop')
    },
    start() {
      events.push('touch.start')
    },
  }

  const runtime = new StackchanRuntimeCamera({ camera, touchPanel })
  await runtime.camera.capture()

  assert.deepEqual(events, ['touch.stop', 'camera.capture', 'camera.stop', 'touch.start'])
})

test('StackchanRuntimeCamera resumes touchPanel when camera start fails', async () => {
  const events: string[] = []
  const camera: RobotCamera = {
    start() {
      events.push('camera.start')
      throw new Error('camera start failed')
    },
    stop() {
      events.push('camera.stop')
    },
    async capture() {
      events.push('camera.capture')
      return undefined
    },
  }
  const touchPanel = {
    stop() {
      events.push('touch.stop')
    },
    start() {
      events.push('touch.start')
    },
  }

  const runtime = new StackchanRuntimeCamera({ camera, touchPanel })

  await assert.rejects(async () => runtime.camera.start(), /camera start failed/)
  assert.deepEqual(events, ['touch.stop', 'camera.start', 'touch.start'])
})

test('close settles a pending capture and discards its late frame without restarting input', async () => {
  let finish: (value: CameraFrame) => void
  let closedFrames = 0
  let resumed = 0
  let closedCamera = 0
  const runtime = new StackchanRuntimeCamera({
    camera: {
      start() {},
      stop() {},
      close() {
        closedCamera += 1
      },
      capture() {
        return new Promise((resolve) => {
          finish = resolve
        })
      },
    },
    touchPanel: {
      stop() {},
      start() {
        resumed += 1
      },
    },
  })
  const captured = runtime.capture()
  const rejected = assert.rejects(captured, { code: 'CLOSED' })
  await runtime.close()
  await rejected
  finish({
    ...frame(),
    close() {
      closedFrames += 1
    },
  })
  await Promise.resolve()
  assert.equal(closedFrames, 1)
  assert.equal(closedCamera, 1)
  assert.equal(resumed, 0)
  assert.throws(() => runtime.start(), { code: 'CLOSED' })
  await assert.rejects(runtime.capture(), { code: 'CLOSED' })
})

test('a stop failure still closes the camera and preserves the failure on every close', async () => {
  let closes = 0
  const failure = new Error('stop failed')
  const runtime = new StackchanRuntimeCamera({
    camera: {
      start() {},
      stop() {
        throw failure
      },
      close() {
        closes += 1
      },
      async capture() {
        return frame()
      },
    },
  })
  const closing = runtime.close()
  assert.equal(closing, runtime.close())
  await assert.rejects(closing, (error) => error === failure)
  await assert.rejects(runtime.close(), (error) => error === failure)
  assert.equal(closes, 1)
})

test('a late start response after close cannot resume touch input or reopen the runtime', async () => {
  let finish: () => void
  let resumed = 0
  const runtime = new StackchanRuntimeCamera({
    camera: {
      start() {
        return new Promise((resolve) => {
          finish = resolve
        })
      },
      stop() {},
      async capture() {
        return frame()
      },
    },
    touchPanel: {
      start() {
        resumed += 1
      },
      stop() {},
    },
  })
  const started = runtime.start() as Promise<void>
  const rejected = assert.rejects(started, { code: 'CLOSED' })
  await runtime.close()
  await rejected
  finish()
  await Promise.resolve()
  assert.equal(resumed, 0)
  assert.throws(() => runtime.start(), { code: 'CLOSED' })
})

test('an unresponsive stop times out and releases the device', async () => {
  const { default: Timer } = await import('../../modules/testing/fakes/timer.js')
  Timer.reset()
  let closes = 0
  const runtime = new StackchanRuntimeCamera({
    camera: {
      start() {},
      stop() {
        return new Promise<void>(() => {})
      },
      close() {
        closes += 1
      },
      async capture() {
        return frame()
      },
    },
  })
  const closing = runtime.close()
  const rejected = assert.rejects(closing, { code: 'TIMEOUT' })
  for (let turn = 0; turn < 4; turn += 1) await Promise.resolve()
  Timer.advance(2_000)
  await rejected
  assert.equal(closes, 1)
  Timer.reset()
})

test('a failed explicit stop closes the camera without resuming the shared touch input', async () => {
  let resumed = 0
  let closes = 0
  const runtime = new StackchanRuntimeCamera({
    camera: {
      start() {},
      stop() {
        throw new Error('stop failed')
      },
      close() {
        closes += 1
      },
      async capture() {
        return frame()
      },
    },
    touchPanel: {
      start() {
        resumed += 1
      },
      stop() {},
    },
  })
  runtime.start()
  assert.throws(() => runtime.stop(), /stop failed/)
  await assert.rejects(runtime.close(), /stop failed/)
  assert.equal(resumed, 0)
  assert.equal(closes, 1)
})
