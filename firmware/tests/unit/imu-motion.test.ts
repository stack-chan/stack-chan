import assert from 'node:assert/strict'
import { test } from 'node:test'

import { type IMUSample, MotionRecognizer, magnitude } from '../../stackchan/imu-motion.js'

function run(samples: IMUSample[], options = {}): string[] {
  const recognizer = new MotionRecognizer(options)
  return samples.flatMap((sample, index) => recognizer.update(sample, index * 100)?.type ?? [])
}

test('detects shake from repeated acceleration magnitude changes', () => {
  assert.deepEqual(
    run([
      { accelerometer: { x: 0, y: 1, z: 0 } },
      { accelerometer: { x: 0, y: 2.5, z: 0 } },
      { accelerometer: { x: 0, y: 1, z: 0 } },
      { accelerometer: { x: 0, y: 2.5, z: 0 } },
      { accelerometer: { x: 0, y: 1, z: 0 } },
      { accelerometer: { x: 0, y: 2.5, z: 0 } },
      { accelerometer: { x: 0, y: 1, z: 0 } },
      { accelerometer: { x: 0, y: 2.5, z: 0 } },
      { accelerometer: { x: 0, y: 1, z: 0 } },
      { accelerometer: { x: 0, y: 2.5, z: 0 } },
      { accelerometer: { x: 0, y: 1, z: 0 } },
    ]),
    ['shake'],
  )
})

test('does not detect servo-like rotation as shake by default', () => {
  assert.deepEqual(
    run([
      { gyroscope: { x: 0, y: 0, z: 0 } },
      { gyroscope: { x: 3, y: 0, z: 0 } },
      { gyroscope: { x: 0, y: 4, z: 0 } },
      { gyroscope: { x: 5, y: 0, z: 0 } },
    ]),
    [],
  )
})

test('detects gyroscope movement when explicitly enabled', () => {
  assert.deepEqual(
    run(
      [
        { gyroscope: { x: 0, y: 0, z: 0 } },
        { gyroscope: { x: 3, y: 0, z: 0 } },
        { gyroscope: { x: 0, y: 4, z: 0 } },
        { gyroscope: { x: 5, y: 0, z: 0 } },
        { gyroscope: { x: 0, y: 5, z: 0 } },
        { gyroscope: { x: 0, y: 0, z: 5 } },
      ],
      { detectGyroscopeShake: true, consecutiveSamples: 5 },
    ),
    ['shake'],
  )
})

test('does not detect one-sample spikes as shake by default', () => {
  assert.deepEqual(
    run([
      { accelerometer: { x: 0, y: 1, z: 0 } },
      { accelerometer: { x: 0, y: 2.5, z: 0 } },
      { accelerometer: { x: 0, y: 2.5, z: 0 } },
      { accelerometer: { x: 0, y: 2.5, z: 0 } },
    ]),
    [],
  )
})

test('suppresses repeated shake events during refractory period', () => {
  assert.deepEqual(
    run(
      [
        { gyroscope: { x: 3, y: 0, z: 0 } },
        { gyroscope: { x: 3, y: 0, z: 0 } },
        { gyroscope: { x: 3, y: 0, z: 0 } },
        { gyroscope: { x: 3, y: 0, z: 0 } },
        { gyroscope: { x: 3, y: 0, z: 0 } },
        { gyroscope: { x: 0, y: 0, z: 0 } },
        { gyroscope: { x: 3, y: 0, z: 0 } },
        { gyroscope: { x: 3, y: 0, z: 0 } },
        { gyroscope: { x: 3, y: 0, z: 0 } },
        { gyroscope: { x: 3, y: 0, z: 0 } },
        { gyroscope: { x: 3, y: 0, z: 0 } },
      ],
      { detectGyroscopeShake: true, consecutiveSamples: 5 },
    ),
    ['shake'],
  )
})

test('detects a left fall from stable gravity direction', () => {
  assert.deepEqual(
    run([
      { accelerometer: { x: 1, y: 0, z: 0 } },
      { accelerometer: { x: 1, y: 0, z: 0 } },
      { accelerometer: { x: 1, y: 0, z: 0 } },
    ]),
    ['fallenLeft'],
  )
})

test('detects posture from the first sample when configured for one consecutive sample', () => {
  assert.deepEqual(run([{ accelerometer: { x: 1, y: 0, z: 0 } }], { postureConsecutiveSamples: 1 }), ['fallenLeft'])
})

test('detects a right fall from stable gravity direction', () => {
  assert.deepEqual(
    run([
      { accelerometer: { x: -1, y: 0, z: 0 } },
      { accelerometer: { x: -1, y: 0, z: 0 } },
      { accelerometer: { x: -1, y: 0, z: 0 } },
    ]),
    ['fallenRight'],
  )
})

test('detects a forward fall from stable gravity direction', () => {
  assert.deepEqual(
    run([
      { accelerometer: { x: 0, y: 0, z: -1 } },
      { accelerometer: { x: 0, y: 0, z: -1 } },
      { accelerometer: { x: 0, y: 0, z: -1 } },
    ]),
    ['fallenForward'],
  )
})

test('detects a backward fall from stable gravity direction', () => {
  assert.deepEqual(
    run([
      { accelerometer: { x: 0, y: 0, z: 1 } },
      { accelerometer: { x: 0, y: 0, z: 1 } },
      { accelerometer: { x: 0, y: 0, z: 1 } },
    ]),
    ['fallenBackward'],
  )
})

test('uses the dominant horizontal axis for diagonal falls', () => {
  assert.deepEqual(
    run([
      { accelerometer: { x: 0.8, y: 0, z: -0.6 } },
      { accelerometer: { x: 0.8, y: 0, z: -0.6 } },
      { accelerometer: { x: 0.8, y: 0, z: -0.6 } },
    ]),
    ['fallenLeft'],
  )
})

test('detects upside-down posture from stable inverted gravity direction', () => {
  assert.deepEqual(
    run([
      { accelerometer: { x: 0, y: -1, z: 0 } },
      { accelerometer: { x: 0, y: -1, z: 0 } },
      { accelerometer: { x: 0, y: -1, z: 0 } },
    ]),
    ['upsideDown'],
  )
})

test('does not emit repeated posture events while posture is unchanged', () => {
  assert.deepEqual(
    run([
      { accelerometer: { x: 0, y: 0, z: 1 } },
      { accelerometer: { x: 0, y: 0, z: 1 } },
      { accelerometer: { x: 0, y: 0, z: 1 } },
      { accelerometer: { x: 0, y: 0, z: 1 } },
      { accelerometer: { x: 0, y: 0, z: 1 } },
    ]),
    ['fallenBackward'],
  )
})

test('detects posture again after returning upright', () => {
  assert.deepEqual(
    run([
      { accelerometer: { x: 1, y: 0, z: 0 } },
      { accelerometer: { x: 1, y: 0, z: 0 } },
      { accelerometer: { x: 1, y: 0, z: 0 } },
      { accelerometer: { x: 0, y: 1, z: 0 } },
      { accelerometer: { x: 0, y: 1, z: 0 } },
      { accelerometer: { x: 0, y: 1, z: 0 } },
      { accelerometer: { x: 0, y: -1, z: 0 } },
      { accelerometer: { x: 0, y: -1, z: 0 } },
      { accelerometer: { x: 0, y: -1, z: 0 } },
    ]),
    ['fallenLeft', 'upsideDown'],
  )
})

test('copies the emitted sample so callers cannot mutate the event', () => {
  const recognizer = new MotionRecognizer({ consecutiveSamples: 1 })
  recognizer.update({ accelerometer: { x: 0, y: 1, z: 0 } }, 0)
  const sample = { accelerometer: { x: 0, y: 3, z: 0 } }
  const motion = recognizer.update(sample, 100)

  assert.equal(motion?.type, 'shake')
  sample.accelerometer.y = 0
  assert.equal(motion?.sample.accelerometer?.y, 3)
})

test('calculates vector magnitude', () => {
  assert.equal(magnitude({ x: 2, y: 3, z: 6 }), 7)
})
