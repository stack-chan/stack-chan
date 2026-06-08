import assert from 'node:assert/strict'
import { test } from 'node:test'

import { GestureRecognizer, type TouchPanelGestureType } from '../../stackchan/touch-panel-gesture.js'

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

test('uses weighted intensity for position calculation', () => {
  const recognizer = new GestureRecognizer()

  assert.equal(recognizer.getPosition([1, 0, 0]), -100)
  assert.equal(recognizer.getPosition([0, 1, 0]), 0)
  assert.equal(recognizer.getPosition([0, 0, 1]), 100)
  assert.equal(recognizer.getPosition([1, 1, 0]), -50)
  assert.equal(recognizer.getPosition([0, 1, 3]), 75)
})
