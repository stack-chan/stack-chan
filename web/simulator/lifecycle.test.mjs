import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHostAudioInBridge, createHostAudioOutBridge, createHostCameraBridge } from './bridge.mjs'
import { closeResources, stopRuntimeCamera, transitionRuntimeAudio } from './lifecycle.mjs'

test('audio transitions start both owners and await the second even after a synchronous failure', async () => {
  const first = new Error('input close')
  const second = new Error('output close')
  let finishOutput,
    settled = false
  const calls = []
  const host = {
    AudioIn: {
      close() {
        calls.push('input')
        throw first
      },
    },
    AudioOut: {
      close() {
        calls.push('output')
        return new Promise((_, reject) => {
          finishOutput = reject
        })
      },
    },
  }
  const closing = transitionRuntimeAudio(host, 'close')
  const rejected = assert.rejects(closing, (error) => {
    assert.ok(error instanceof AggregateError)
    assert.deepEqual(error.errors, [first, second])
    settled = true
    return true
  })
  await Promise.resolve()
  assert.deepEqual(calls, ['input', 'output'])
  assert.equal(settled, false)
  finishOutput(second)
  await rejected
})

test('audio restart cannot resume either owner until both acknowledge suspension', async () => {
  const finishes = [],
    events = []
  const owner = (name) => ({
    suspend() {
      events.push(`${name}:suspend`)
      return new Promise((resolve) => finishes.push(resolve))
    },
    resume() {
      events.push(`${name}:resume`)
    },
  })
  const host = { AudioIn: owner('input'), AudioOut: owner('output') }
  const restarting = transitionRuntimeAudio(host, 'suspend').then(() => transitionRuntimeAudio(host, 'resume'))
  finishes[0]()
  await Promise.resolve()
  assert.deepEqual(events, ['input:suspend', 'output:suspend'])
  finishes[1]()
  await restarting
  assert.deepEqual(events, ['input:suspend', 'output:suspend', 'input:resume', 'output:resume'])
})

test('retired VMs cannot retain new audio handles during or after the suspend snapshot', async () => {
  for (const { bridge, start, release } of [
    {
      bridge: createHostAudioInBridge(),
      start: (bridge) => bridge.startRecord(0),
      release: (bridge, id) => bridge.releaseRecord(id),
    },
    {
      bridge: createHostAudioOutBridge(),
      start: (bridge) => bridge.startTone({ hz: 0, duration: 1 }),
      release: (bridge, id) => bridge.releasePlay(id),
    },
  ]) {
    for (let cycle = 0; cycle < 100; cycle++) {
      const suspended = bridge.suspend()
      for (let index = 0; index < 10; index++) assert.equal(start(bridge), 0)
      await suspended
      for (let index = 0; index < 10; index++) assert.equal(start(bridge), 0)
      bridge.resume()
      const ids = Array.from({ length: 4 }, () => start(bridge))
      assert.ok(
        ids.every((id) => id > 0),
        'the next VM has its complete handle budget'
      )
      ids.forEach((id) => release(bridge, id))
    }
    await bridge.close()
    assert.equal(start(bridge), 0)
  }
})

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
