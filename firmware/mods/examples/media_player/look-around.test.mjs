import assert from 'node:assert/strict'
import test from 'node:test'
import { installLookAround } from './look-around.js'

function harness(torque = async () => {}) {
  const events = [],
    timers = [],
    states = []
  let button
  const context = {
    audio: { volume: 0.25, media: { state: 'playing' } },
    i18n: { localize: () => '見回す' },
    drawer: {
      addDrawerButton(value) {
        button = value
      },
      setDrawerButtonState(_key, enabled) {
        states.push(enabled)
      },
    },
    motion: {
      async setTorque(enabled) {
        events.push(['torque', enabled])
        await torque(enabled)
      },
      lookAt(point) {
        events.push(['look', point])
      },
      lookAway() {
        events.push(['away'])
      },
    },
  }
  const close = installLookAround(
    context,
    {
      repeat(callback, interval) {
        const timer = { callback, interval, cleared: false }
        timers.push(timer)
        return timer
      },
      clear(timer) {
        timer.cleared = true
      },
    },
    (minimum, maximum) => (minimum + maximum) / 2,
  )
  return { context, events, timers, states, close, button }
}

test('Look Around is off at startup and starts/stops only through the Drawer without touching audio', async () => {
  const h = harness()
  assert.equal(h.button.kind, 'toggle')
  assert.equal(h.button.label, '見回す')
  assert.equal(h.button.initialState, false)
  assert.deepEqual(h.events, [])
  assert.deepEqual(h.timers, [])
  await h.button.callback()
  assert.deepEqual(
    h.events.map(([event]) => event),
    ['torque', 'look'],
  )
  assert.equal(h.events[0][1], true)
  const [x, y, z] = h.events[1][1]
  assert(x >= 0.4 && x <= 1 && y >= -0.4 && y <= 0.4 && z >= -0.02 && z <= 0.2)
  assert.equal(h.timers.length, 1)
  assert.equal(h.timers[0].interval, 5000)
  assert.equal(h.states.at(-1), true)
  h.timers[0].callback()
  assert.equal(h.events.filter(([event]) => event === 'look').length, 2)
  await h.button.callback()
  assert.equal(h.timers[0].cleared, true)
  assert.deepEqual(h.events.slice(-2), [['away'], ['torque', false]])
  assert.equal(h.states.at(-1), false)
  const count = h.events.length
  h.timers[0].callback() // A callback already queued before Timer.clear must be harmless.
  assert.equal(h.events.length, count)
  assert.deepEqual(h.context.audio, { volume: 0.25, media: { state: 'playing' } })
  await h.close()
})

test('repeated taps do not overlap torque requests and close cannot restart a pending enable', async () => {
  let finish
  const h = harness((enabled) =>
    enabled
      ? new Promise((resolve) => {
          finish = resolve
        })
      : Promise.resolve(),
  )
  const first = h.button.callback()
  assert.equal(h.button.callback(), first)
  assert.deepEqual(h.events, [['torque', true]])
  const closing = h.close()
  assert.equal(h.states.at(-1), false)
  finish()
  await Promise.all([first, closing])
  assert.deepEqual(h.events, [['torque', true], ['away'], ['torque', false]])
  assert.equal(h.timers.length, 0)
  const count = h.events.length
  await h.button.callback()
  assert.equal(h.events.length, count)
})

test('a rejected torque enable leaves tracking off and attempts torque release', async () => {
  const h = harness(async (enabled) => {
    if (enabled) throw new Error('motion_disabled')
  })
  await assert.rejects(h.button.callback(), /motion_disabled/)
  assert.deepEqual(h.events, [['torque', true], ['away'], ['torque', false]])
  assert.equal(h.timers.length, 0)
  assert.equal(h.states.at(-1), false)
  await h.close()
})

test('stopping cancels future gaze updates even if torque release fails', async () => {
  const h = harness(async (enabled) => {
    if (!enabled) throw new Error('servo unavailable')
  })
  await h.button.callback()
  await assert.rejects(h.button.callback(), /servo unavailable/)
  const count = h.events.length
  h.timers[0].callback()
  assert.equal(h.events.length, count)
  assert.equal(h.states.at(-1), false)
  assert.equal(h.timers[0].cleared, true)
  await assert.rejects(h.close(), /servo unavailable/)
})
