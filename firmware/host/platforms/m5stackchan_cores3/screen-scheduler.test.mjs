import assert from 'node:assert/strict'
import test from 'node:test'
import { scheduleScreen, trackScreenSchedule } from './screen-scheduler.js'

function fixture(onIdle = () => {}, { tracked = false } = {}) {
  let now = 0,
    timer,
    calls = []
  const normal = []
  const screen = Object.create(
    Object.freeze({
      start(interval) {
        assert.equal(this, screen)
        normal.push(interval)
      },
      stop() {
        assert.equal(this, screen)
        normal.push(undefined)
      },
    }),
  )
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
    clear(id) {
      assert.equal(id, timer)
      timer = undefined
    },
  }
  const acquire = tracked ? trackScreenSchedule(screen, Timer, 20) : undefined
  if (!tracked) scheduleScreen(screen, Timer, 20)
  return {
    screen,
    calls,
    normal,
    acquire,
    Timer,
    hasTimer: () => timer !== undefined,
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

test('session scheduler returns the latest screen request to the normal timer at release', () => {
  const f = fixture(() => f.screen.start(12), { tracked: true })
  f.screen.start(7)
  const release = f.acquire()
  assert.deepEqual(f.normal, [7, undefined])
  assert.equal(f.calls.at(-1).interval, 20)
  f.fire()
  assert.deepEqual(f.normal, [7, undefined])
  release()
  release()
  assert.deepEqual(f.normal, [7, undefined, 12])
  assert.equal(f.hasTimer(), false)
  f.screen.start(9)
  assert.equal(f.normal.at(-1), 9)
})

test('release from an idle callback leaves no pending timer or revived stopped screen', () => {
  const f = fixture(
    () => {
      f.screen.stop()
      release()
    },
    { tracked: true },
  )
  f.screen.start(7)
  const release = f.acquire()
  f.fire()
  assert.deepEqual(f.normal, [7, undefined])
  assert.equal(f.hasTimer(), false)
  const secondRelease = f.acquire()
  f.screen.start(40)
  release()
  assert.equal(f.hasTimer(), true)
  secondRelease()
  assert.equal(f.normal.at(-1), 40)
})

test('a failed timer allocation restores the SDK cadence and permits retry', () => {
  const f = fixture(undefined, { tracked: true })
  const allocate = f.Timer.set
  f.screen.start(12)
  f.Timer.set = () => {
    throw new Error('timer allocation failed')
  }
  assert.throws(f.acquire, /timer allocation failed/)
  assert.deepEqual(f.normal, [12, undefined, 12])
  f.Timer.set = allocate
  f.acquire()()
  assert.equal(f.normal.at(-1), 12)
  assert.equal(f.hasTimer(), false)
})
