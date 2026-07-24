import assert from 'node:assert/strict'
import test from 'node:test'

import {
  countExtendedFingers,
  faceGeometry,
  facePartsFromBlendshapes,
  facePoseFromMatrix,
  fingerCountBucket,
  FingerCountStabilizer,
  handVariant,
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

function faceFixture() {
  return [point(0.4, 0.3), point(0.6, 0.3), point(0.6, 0.7), point(0.4, 0.7)]
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

test('finger count stabilizer confirms increases and accepts decreases immediately', () => {
  const stabilizer = new FingerCountStabilizer()
  assert.equal(stabilizer.update('left', 2), 2)
  assert.equal(stabilizer.update('left', 3), 2, 'one higher reading should be held back')
  assert.equal(stabilizer.update('left', 3), 3, 'two high readings should increase the result')
  assert.equal(stabilizer.update('left', 2), 2, 'a lower reading should win a tie without adding upward bias')
  stabilizer.missing('left')
  assert.equal(stabilizer.update('left', 1), 1, 'a missing hand should clear its history')
})

test('partly folded fingers do not pass the stricter extension geometry', () => {
  const landmarks = handFixture(1)
  landmarks[7] = point(0.32, 0.41)
  landmarks[8] = point(0.38, 0.28)
  assert.equal(countExtendedFingers(landmarks), 1)
})

test('a visibly extended finger tolerates moderate landmark bend', () => {
  const landmarks = handFixture(2)
  landmarks[8] = point(0.37, 0.25)
  assert.equal(countExtendedFingers(landmarks), 2)
})

test('face geometry is mirrored and hand variants follow the palm axis', () => {
  const geometry = faceGeometry(faceFixture())
  assert.equal(geometry.x, 0.5)
  assert.equal(geometry.y, 0.5)
  assert.ok(Math.abs(geometry.width - 0.2) < 1e-9)
  assert.ok(Math.abs(geometry.height - 0.4) < 1e-9)
  const landmarks = handFixture(3)
  landmarks[0] = point(0.5, 0.8)
  landmarks[9] = point(0.5, 0.5)
  assert.equal(handVariant(landmarks), 0, 'fingers toward screen top should select the up variant')
  landmarks[9] = point(0.2, 0.8)
  assert.equal(handVariant(landmarks), 2, 'mirrored fingers toward screen right should select the right variant')
})

test('face matrix keeps camera yaw for mirror motion and allows a 90-degree upward pitch', () => {
  const yaw = 0.4
  const pitch = -Math.PI / 2
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  const matrix = [cy, 0, -sy, 0, sy * sp, cp, cy * sp, 0, sy * cp, -sp, cy * cp, 0, 0, 0, 0, 1]
  const pose = facePoseFromMatrix(matrix)
  assert.ok(Math.abs(pose.yaw - yaw) < 1e-9)
  assert.ok(Math.abs(pose.pitch - pitch) < 1e-9)
})

test('face blendshapes map independent eyelids and jaw opening into unit values', () => {
  const parts = facePartsFromBlendshapes({
    categories: [
      { categoryName: 'eyeBlinkLeft', score: 0.8 },
      { categoryName: 'eyeBlinkRight', score: 0.25 },
      { categoryName: 'jawOpen', score: 0.6 },
    ],
  })
  assert.ok(Math.abs(parts.eyeOpen.left - 0.2) < 1e-9)
  assert.equal(parts.eyeOpen.right, 0.75)
  assert.equal(parts.mouthOpen, 0.6)
})

test('smile classifier applies hysteresis', () => {
  const classifier = new SmileClassifier()
  const blend = (score) => ({
    categories: [
      { categoryName: 'mouthSmileLeft', score },
      { categoryName: 'mouthSmileRight', score },
    ],
  })
  assert.equal(classifier.update(blend(0.34)), 'neutral')
  assert.equal(classifier.update(blend(0.4)), 'happy')
  assert.equal(classifier.update(blend(0.25)), 'happy')
  assert.equal(classifier.update(blend(0.19)), 'neutral')
})

test('tracking builder maps hands to mirrored face-relative coordinates and direction variants', () => {
  const builder = new TrackingStateBuilder()
  const result = builder.build(
    {
      faceLandmarks: [faceFixture()],
    },
    {
      landmarks: [handFixture(2)],
      handednesses: [[{ categoryName: 'Right', score: 0.99 }]],
    }
  )
  assert.equal(result.version, 4)
  assert.equal(result.face, null)
  assert.equal(result.hands.left.fingerCount, 2)
  assert.equal(result.hands.right, null)
  assert.ok(result.hands.left.x > 0, 'a mirrored palm right of face center should have a positive relative x')
  assert.ok(result.hands.left.y > 0, 'a palm below face center should have a positive relative y')
  assert.ok(result.hands.left.variant >= 0 && result.hands.left.variant <= 7)
})
