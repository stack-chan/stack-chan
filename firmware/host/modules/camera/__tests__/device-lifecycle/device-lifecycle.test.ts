import NativeCamera from 'embedded:io/image/in/camera'
import Camera from 'device-camera'
import { assert, equal } from 'testing/assert'

async function run() {
  const camera = new Camera()
  camera.start()
  const native = NativeCamera.current
  assert(native, 'camera creates its native input')
  let framesClosed = 0
  const frame = new ArrayBuffer(2)
  Object.defineProperty(frame, 'close', {
    value: () => {
      framesClosed += 1
    },
  })
  native.frame = frame
  native.readable()
  const stopFailure = new Error('native stop failed')
  native.stopFailure = stopFailure
  let failure: unknown
  try {
    camera.close()
  } catch (error) {
    failure = error
  }
  equal(failure, stopFailure, 'stop failure is returned')
  equal(native.closes, 1, 'native input still closes after stop fails')
  equal(framesClosed, 1, 'cached disposable frame is still released')
  camera.close()
  equal(native.closes, 1, 'native input is not closed twice')
  let restartFailed = false
  try {
    camera.start()
  } catch {
    restartFailed = true
  }
  assert(restartFailed, 'closed camera cannot reopen')

  const startFailure = new Error('native start failed')
  NativeCamera.startFailure = startFailure
  const failedStart = new Camera()
  failure = undefined
  try {
    failedStart.start()
  } catch (error) {
    failure = error
  }
  equal(failure, startFailure, 'start failure is preserved')
  equal(NativeCamera.current.closes, 1, 'failed start releases the native input')
  failedStart.close()
  equal(NativeCamera.current.closes, 1, 'rollback and close share device release')
  NativeCamera.startFailure = undefined

  const waiting = new Camera()
  const capture = waiting.capture()
  const waitingNative = NativeCamera.current
  waiting.close()
  equal(await capture, undefined, 'closing while waiting for a frame settles capture')
  equal(waitingNative.closes, 1, 'pending capture does not retain the input')
  trace('ok\n')
}
run().catch((error) => {
  trace(`camera lifecycle failed: ${String(error)}\n`)
  throw error
})
