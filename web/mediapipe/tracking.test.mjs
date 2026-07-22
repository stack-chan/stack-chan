import assert from 'node:assert/strict'
import test from 'node:test'

import {
  countExtendedFingers,
  facePoseFromMatrix,
  fingerCountBucket,
  FingerCountStabilizer,
  palmCenter,
  SmileClassifier,
  TrackingStateBuilder,
} from './tracking.mjs'

function point(x, y, z = 0) {
  return { x, y, z }
}

function handFixture(extendedCount) {
  const landmarks = Array.from({ length: 21 }, () => point(0.5, 0.7))
  landmarks[0] = point(0.5, 0.9)
  const bases = [0.32, 0.43, 0.54, 0.65]
  for (let finger = 0; finger < 4; finger += 1) {
    const base = 5 + finger * 4
    const x = bases[finger]
    landmarks[base] = point(x, 0.68)
    if (finger < Math.max(0, extendedCount - 1)) {
      landmarks[base + 1] = point(x, 0.54)
      landmarks[base + 2] = point(x, 0.4)
      landmarks[base + 3] = point(x, 0.25)
    } else {
      landmarks[base + 1] = point(x, 0.58)
      landmarks[base + 2] = point(x + 0.05, 0.62)
      landmarks[base + 3] = point(x + 0.08, 0.68)
    }
  }
  landmarks[1] = point(0.43, 0.72)
  landmarks[2] = point(0.36, 0.67)
  if (extendedCount > 0) {
    landmarks[3] = point(0.28, 0.62)
    landmarks[4] = point(0.18, 0.56)
  } else {
    landmarks[3] = point(0.38, 0.62)
    landmarks[4] = point(0.45, 0.65)
  }
  return landmarks
}

test('palm center averages wrist and MCP landmarks', () => {
  const center = palmCenter(handFixture(5))
  assert.ok(center.x > 0.45 && center.x < 0.55)
  assert.ok(center.y > 0.7 && center.y < 0.8)
})

test('finger geometry distinguishes 0, 1, 2, and 3-or-more sprite buckets', () => {
  for (const count of [0, 1, 2, 3, 5]) {
    assert.equal(countExtendedFingers(handFixture(count)), count)
    assert.equal(fingerCountBucket(count), Math.min(count, 3))
  }
})

test('finger count stabilizer uses the majority of the latest three frames', () => {
  const stabilizer = new FingerCountStabilizer()
  assert.equal(stabilizer.update('left', 2), 2)
  assert.equal(stabilizer.update('left', 3), 3, 'a tie should prefer the latest reading')
  assert.equal(stabilizer.update('left', 2), 2)
  assert.equal(stabilizer.update('left', 3), 3, 'the rolling window should advance')
  stabilizer.missing('left')
  assert.equal(stabilizer.update('left', 1), 1, 'a missing hand should clear its history')
})

test('face matrix yields mirrored bounded yaw and pitch', () => {
  const yaw = 0.4
  const pitch = -0.2
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  const matrix = [cy, 0, -sy, 0, sy * sp, cp, cy * sp, 0, sy * cp, -sp, cy * cp, 0, 0, 0, 0, 1]
  const pose = facePoseFromMatrix(matrix)
  assert.ok(Math.abs(pose.yaw + yaw) < 1e-9)
  assert.ok(Math.abs(pose.pitch - pitch) < 1e-9)
})

test('smile classifier applies hysteresis', () => {
  const classifier = new SmileClassifier()
  const blend = (score) => ({
    categories: [
      { categoryName: 'mouthSmileLeft', score },
      { categoryName: 'mouthSmileRight', score },
    ],
  })
  assert.equal(classifier.update(blend(0.54)), 'neutral')
  assert.equal(classifier.update(blend(0.7)), 'happy')
  assert.equal(classifier.update(blend(0.45)), 'happy')
  assert.equal(classifier.update(blend(0.3)), 'neutral')
})

test('tracking builder mirrors hand coordinates and swaps handedness for an avatar mirror', () => {
  const builder = new TrackingStateBuilder()
  const result = builder.build(
    {},
    {
      landmarks: [handFixture(2)],
      handednesses: [[{ categoryName: 'Right', score: 0.99 }]],
    }
  )
  assert.equal(result.version, 1)
  assert.equal(result.face, null)
  assert.equal(result.hands.left.fingerCount, 2)
  assert.equal(result.hands.right, null)
  assert.ok(result.hands.left.x >= 0 && result.hands.left.x <= 1)
})
