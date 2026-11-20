import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { CameraCaptureOptions, CameraFrame, RobotCamera } from '../../modules/camera/camera.js'
import { StackchanRuntimeCamera } from '../runtime-camera.js'

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

test('StackchanRuntimeCamera close releases the camera without resuming touchPanel', () => {
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

  assert.equal(result, undefined)
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

  assert.deepEqual(events, ['touch.stop', 'camera.capture', 'touch.start'])
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
