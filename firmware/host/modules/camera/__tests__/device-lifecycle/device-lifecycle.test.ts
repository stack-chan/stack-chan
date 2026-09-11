import Resource from 'Resource'
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

  // Resource supplies a real XS HostBuffer, unlike the ArrayBuffer fakes below.
  // Hide its slice method to match a disposable camera frame's interface.
  const captured = new Camera()
  captured.start()
  const hostFrame = new Resource('camera-frame.txt')
  let released = 0
  Object.defineProperties(hostFrame, {
    slice: { value: undefined },
    close: { value: () => released++ },
  })
  assert(!(hostFrame instanceof ArrayBuffer), 'fixture uses native buffer semantics')
  NativeCamera.current.frame = hostFrame
  const owned = await captured.capture()
  assert(owned, 'native frame is captured')
  assert(owned.buffer instanceof ArrayBuffer, 'capture normalizes native storage to an ArrayBuffer')
  equal(released, 1, 'native frame is released before capture resolves')
  equal(String.fromArrayBuffer(owned.buffer), 'native camera frame\n', 'capture preserves all bytes')
  captured.stop()
  captured.close()
  equal(released, 1, 'stop and close do not release the returned frame again')
  equal(String.fromArrayBuffer(owned.buffer), 'native camera frame\n', 'owned pixels survive camera close')

  const waiting = new Camera()
  const capture = waiting.capture()
  const waitingNative = NativeCamera.current
  waiting.close()
  equal(await capture, undefined, 'closing while waiting for a frame settles capture')
  equal(waitingNative.closes, 1, 'pending capture does not retain the input')
  const reusable = new Camera()
  for (let cycle = 0; cycle < 100; cycle++) {
    reusable.start()
    const oldCapture = reusable.capture()
    reusable.stop()
    reusable.start()
    const currentNative = NativeCamera.current
    const fresh = new ArrayBuffer(2)
    currentNative.frame = fresh
    const newCapture = reusable.capture()
    equal(await oldCapture, undefined, 'stopped capture cannot consume a newer frame')
    const result = await newCapture
    assert(result && result.buffer !== fresh, 'new capture owns a copy of its frame')
    new Uint8Array(fresh)[0] = 42
    equal(new Uint8Array(result.buffer)[0], 0, 'native storage reuse cannot change the captured image')
    reusable.stop()
  }
  const obsoleteNative = NativeCamera.current
  reusable.start({ width: 100 })
  const currentNative = NativeCamera.current
  const fresh = new ArrayBuffer(2)
  currentNative.frame = fresh
  obsoleteNative.readable()
  equal(currentNative.frame, fresh, 'callback from an old input cannot read the current input')
  reusable.close()
  trace('ok\n')
}
run().catch((error) => {
  trace(`camera lifecycle failed: ${String(error)}\n`)
  throw error
})
