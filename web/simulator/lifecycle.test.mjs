import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHostCameraBridge } from './bridge.mjs'
import { closeResources, stopRuntimeCamera } from './lifecycle.mjs'

test('a failed cleanup still releases every later resource and preserves the first failure', () => {
  const first = new Error('first')
  const calls = []
  assert.throws(
    () =>
      closeResources([
        () => {
          calls.push('camera')
          throw first
        },
        () => {
          calls.push('XS')
          throw new Error('second')
        },
        () => {
          calls.push('view')
        },
      ]),
    (error) => error === first
  )
  assert.deepEqual(calls, ['camera', 'XS', 'view'])
})

test('quitting a VM invalidates its pending native start before stopping the browser', async () => {
  let startCalls = 0
  const pending = { active: true }
  const runtime = {
    state: { cameraStart: pending, cameraCapture: new ArrayBuffer(4) },
    host: {
      Camera: {
        stop() {
          assert.equal(pending.active, false)
        },
      },
    },
  }
  const reserved = Promise.resolve().then(() => {
    if (pending.active) startCalls++
  })
  stopRuntimeCamera(runtime)
  await reserved
  assert.equal(startCalls, 0)
  assert.equal(runtime.state.cameraCapture, undefined)
})

test('restarting during browser permission releases a late stream and allows the next VM to acquire its own', async () => {
  let receive
  let stopped = 0
  const bridge = createHostCameraBridge({
    videoElement: { play: async () => {} },
    navigatorObj: {
      mediaDevices: {
        getUserMedia() {
          return new Promise((resolve) => {
            receive = resolve
          })
        },
      },
    },
  })
  const runtime = { state: { cameraStart: { active: true } }, host: { Camera: bridge } }
  const old = bridge.start()
  const failed = assert.rejects(old, { code: 'CANCELLED' })
  await Promise.resolve()
  stopRuntimeCamera(runtime)
  receive({
    getTracks: () => [
      {
        stop() {
          stopped++
        },
      },
    ],
  })
  await failed
  assert.equal(stopped, 1)
  assert.equal(bridge.isStarted(), false)
  const next = bridge.start()
  await Promise.resolve()
  receive({
    getTracks: () => [
      {
        stop() {
          stopped++
        },
      },
    ],
  })
  await next
  stopRuntimeCamera(runtime)
  assert.equal(stopped, 2)
})
