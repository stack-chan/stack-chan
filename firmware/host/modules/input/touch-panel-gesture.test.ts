import assert from 'node:assert/strict'
import { test } from 'node:test'

import { GestureRecognizer, type TouchPanelGestureType } from './touch-panel-gesture.js'

function run(samples: number[][]): TouchPanelGestureType[] {
  const recognizer = new GestureRecognizer()
  return samples.flatMap((sample, index) => recognizer.update(sample, index * 50)?.type ?? [])
}

test('recognizes press and release from Si12T intensity samples', () => {
  assert.deepEqual(
    run([
      [0, 0, 0],
      [0, 1, 0],
      [0, 1, 0],
      [0, 0, 0],
    ]),
    ['press', 'release'],
  )
})

test('marks a short stable release as a tap', () => {
  const recognizer = new GestureRecognizer()

  assert.equal(recognizer.update([0, 1, 0], 100)?.type, 'press')
  assert.equal(recognizer.update([0, 6, 1], 250), undefined)
  assert.deepEqual(recognizer.update([0, 0, 0], 400), {
    type: 'release',
    sample: [0, 0, 0],
    ticks: 400,
    tap: {
      durationMs: 300,
      maxMovement: 14,
      position: 0,
    },
  })
})

test('does not mark long or drifting touches as taps', () => {
  const longPress = new GestureRecognizer()
  longPress.update([0, 1, 0], 0)
  assert.equal(longPress.update([0, 0, 0], 301)?.tap, undefined)

  const driftingPress = new GestureRecognizer()
  driftingPress.update([0, 1, 0], 0)
  driftingPress.update([0, 5, 1], 100)
  assert.equal(driftingPress.update([0, 0, 0], 200)?.tap, undefined)
})

test('recognizes forward swipe when weighted position moves past positive threshold', () => {
  assert.deepEqual(
    run([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0, 0, 0],
    ]),
    ['press', 'forwardSwipe', 'release'],
  )
})

test('recognizes backward swipe when weighted position moves past negative threshold', () => {
  assert.deepEqual(
    run([
      [0, 0, 1],
      [0, 1, 0],
      [1, 0, 0],
      [0, 0, 0],
    ]),
    ['press', 'backwardSwipe', 'release'],
  )
})

test('does not treat a 50-point position wobble as a swipe', () => {
  assert.deepEqual(
    run([
      [0, 1, 0],
      [0, 1, 1],
      [0, 0, 0],
    ]),
    ['press', 'release'],
  )
})

test('recognizes a deliberate swipe beyond the 60-point threshold', () => {
  assert.deepEqual(
    run([
      [0, 1, 0],
      [0, 1, 2],
      [0, 0, 0],
    ]),
    ['press', 'forwardSwipe', 'release'],
  )
})

test('does not emit repeated swipe gestures while still touching', () => {
  assert.deepEqual(
    run([
      [1, 0, 0],
      [0, 0, 1],
      [0, 0, 2],
      [0, 1, 1],
      [0, 0, 0],
    ]),
    ['press', 'forwardSwipe', 'release'],
  )
})

test('does not mark a completed swipe release as a tap', () => {
  const recognizer = new GestureRecognizer()
  recognizer.update([1, 0, 0], 0)
  recognizer.update([0, 0, 1], 50)

  assert.equal(recognizer.update([0, 0, 0], 100)?.tap, undefined)
})

test('uses weighted intensity for position calculation', () => {
  const recognizer = new GestureRecognizer()

  assert.equal(recognizer.getPosition([1, 0, 0]), -100)
  assert.equal(recognizer.getPosition([0, 1, 0]), 0)
  assert.equal(recognizer.getPosition([0, 0, 1]), 100)
  assert.equal(recognizer.getPosition([1, 1, 0]), -50)
  assert.equal(recognizer.getPosition([0, 1, 3]), 75)
})
