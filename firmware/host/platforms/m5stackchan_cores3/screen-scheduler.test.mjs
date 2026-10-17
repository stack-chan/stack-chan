import assert from 'node:assert/strict'
import test from 'node:test'
import { scheduleScreen } from './screen-scheduler.js'

function fixture(onIdle = () => {}) {
  let now = 0,
    timer,
    calls = []
  const screen = Object.create(Object.freeze({ start() {}, stop() {} }))
  screen.context = { onIdle }
  const Timer = {
    set(callback, interval, repeat) {
      timer = { callback }
      this.schedule(timer, interval, repeat)
      return timer
    },
    schedule(id, interval, repeat) {
      assert.equal(id, timer)
      calls.push({ at: now, interval, repeat })
    },
  }
  scheduleScreen(screen, Timer, 20)
  return {
    screen,
    calls,
    advance: (ms) => {
      now += ms
    },
    fire: () => timer.callback(),
  }
}
test('slow screen callbacks schedule from completion and respect requested cadence', () => {
  const f = fixture(() => f.advance(350))
  f.screen.start(5)
  assert.ok(f.calls.at(-1).interval >= 20)
  f.fire()
  assert.equal(f.calls.at(-1).at, 350)
  assert.equal(f.calls.at(-1).interval, 20)
  f.screen.start(200)
  f.fire()
  assert.equal(f.calls.at(-1).interval, 200)
})
test('stop during a frame is not overwritten by its completion', () => {
  const f = fixture(() => f.screen.stop())
  f.screen.start(100)
  f.fire()
  assert.equal(f.calls.at(-1).interval, undefined)
})
test('a cadence change during a frame takes effect after that frame', () => {
  const f = fixture(() => f.screen.start(80))
  f.screen.start(100)
  f.fire()
  assert.equal(f.calls.at(-1).interval, 80)
})
test('a detached context suspends the timer and a new one can resume', () => {
  let frames = 0
  const f = fixture()
  f.screen.start(50)
  f.screen.context = undefined
  f.fire()
  assert.equal(f.calls.at(-1).interval, undefined)
  f.screen.context = {
    onIdle() {
      frames++
    },
  }
  f.screen.start(50)
  f.fire()
  assert.equal(frames, 1)
  assert.equal(f.calls.at(-1).interval, 50)
})
