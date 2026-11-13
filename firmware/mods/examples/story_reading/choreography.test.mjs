import assert from 'node:assert/strict'
import test from 'node:test'
import { ReadingChoreography, readingGaze } from './choreography.js'
import { ReadingFaceRenderer } from './face-renderer.js'

test('gaze follows a screen-facing inverse Z with downward horizontal rows', () => {
  assert.deepEqual(readingGaze(0), { x: 0.9, y: 0.2 })
  assert.deepEqual(readingGaze(3400), { x: -0.9, y: 0.2 })
  assert.deepEqual(readingGaze(4000), { x: 0.9, y: 0.9 })
  assert.deepEqual(readingGaze(7400), { x: -0.9, y: 0.9 })
  assert.deepEqual(readingGaze(8000), readingGaze(0))
  for (let time = 0; time < 24000; time += 120) {
    const gaze = readingGaze(time)
    assert(Math.abs(gaze.x) <= 1 && Math.abs(gaze.y) <= 1)
  }
})

test('turning closes the mouth and holds the exact preceding gaze for all five variants', () => {
  const animation = new ReadingChoreography()
  let last
  for (let time = 0; time < 19900; time += 100) last = animation.advance(100)
  const variants = []
  for (let time = 0; time < 1000; time += 100) {
    const frame = animation.advance(100)
    assert.equal(frame.turning, true)
    assert.equal(frame.mouth, 0)
    assert.deepEqual(frame.gaze, last.gaze)
    variants.push(frame.variant)
  }
  assert.deepEqual([...new Set(variants)], [1, 2, 3, 4, 5])
  const next = animation.advance(100)
  assert.equal(next.turning, false)
  assert.equal(next.variant, 0)
  assert.deepEqual(next.gaze, readingGaze(0))
  assert(next.mouth > 0)
})

test('repeated page cycles remain bounded and interval validation rejects bad inputs', () => {
  const animation = new ReadingChoreography()
  let turns = 0,
    previous = false
  for (let i = 0; i < 2000; ++i) {
    const frame = animation.advance()
    if (frame.turning && !previous) ++turns
    previous = frame.turning
    assert(frame.variant >= 0 && frame.variant <= 5)
    assert(frame.mouth >= 0 && frame.mouth <= 1)
  }
  assert(turns >= 10)
  for (const interval of [-1, NaN, Infinity]) assert.throws(() => animation.advance(interval), RangeError)
})

test('face renderer preserves host state, overrides drawn gaze only, and restores host gaze on clear', () => {
  const state = () => ({
    mouth: { open: 0 },
    eyes: { left: { open: 0.5, gazeX: -0.2, gazeY: -0.3 }, right: { open: 1, gazeX: 0.2, gazeY: -0.3 } },
    breath: 0,
    emotion: 2,
    theme: { primary: { r: 9, g: 8, b: 7 }, secondary: { r: 1, g: 2, b: 3 } },
  })
  const host = state(),
    updates = []
  let renderer
  const context = {
    get motion() {
      throw new Error('Display animation must not access motion')
    },
    face: {
      setMouthOpen(value, immediate) {
        assert.equal(immediate, true)
        host.mouth.open = value
        renderer.capture(host)
        updates.push(structuredClone(host))
      },
    },
    ui: {
      update(_interval, frame) {
        updates.push(structuredClone(frame))
        renderer.capture(frame)
      },
    },
  }
  renderer = new ReadingFaceRenderer(context, state, (from, to) => Object.assign(to, structuredClone(from)))
  renderer.capture(host)
  renderer.render(0.7, { x: 0.9, y: 0.2 })
  const drawn = updates.at(-1)
  assert.equal(drawn.mouth.open, 0.7)
  assert.equal(drawn.eyes.left.gazeX, 0.9)
  assert.equal(drawn.eyes.left.open, 0.5)
  assert.equal(drawn.eyes.right.open, 1)
  assert.deepEqual(drawn.theme, host.theme)
  assert.equal(drawn.emotion, host.emotion)
  assert.equal(host.eyes.left.gazeX, -0.2)
  host.theme.primary.r = 125
  renderer.render(0, { x: -0.8, y: 0.9 })
  assert.equal(updates.at(-1).theme.primary.r, 125)
  const frozen = structuredClone(updates.at(-1))
  renderer.restore()
  assert.deepEqual(updates.at(-1), frozen)
  renderer.clear()
  assert.equal(updates.at(-1).mouth.open, 0)
  assert.equal(updates.at(-1).eyes.left.gazeX, -0.2)
  const clearedCount = updates.length
  renderer.restore()
  assert.equal(updates.length, clearedCount, 'redisplay after clear must not resurrect a reading frame')
})
