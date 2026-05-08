import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  SCREEN_CANVAS,
  STACKCHAN_FACE_MM,
  STACKCHAN_FOOT_MM,
  computeFootPlacements,
  computeScreenPlane,
  createRoundedRectPath,
  computeStackchanKinematics,
  nextLookAroundPose,
  nextSpeechScale,
} from './geometry.mjs'

describe('Stack-chan simulator geometry', () => {
  it('defines the shishikawa Stack-chan body as a 54mm rounded cube with 4mm corners', () => {
    assert.equal(STACKCHAN_FACE_MM.width, 54)
    assert.equal(STACKCHAN_FACE_MM.height, 54)
    assert.equal(STACKCHAN_FACE_MM.depth, 54)
    assert.equal(STACKCHAN_FACE_MM.radius, 4)
  })

  it('defines two 24mm x 8mm x 48mm feet beneath the body', () => {
    assert.equal(STACKCHAN_FOOT_MM.width, 24)
    assert.equal(STACKCHAN_FOOT_MM.height, 8)
    assert.equal(STACKCHAN_FOOT_MM.depth, 48)
    assert.equal(STACKCHAN_FOOT_MM.count, 2)

    const feet = computeFootPlacements()
    assert.equal(feet.length, 2)
    assert.deepEqual(
      feet.map((foot) => foot.y),
      [-33, -33],
    )
    assert.deepEqual(
      feet.map((foot) => foot.x),
      [-13, 13],
    )
    assert.deepEqual(
      feet.map((foot) => foot.z),
      [0, 0],
    )
  })

  it('creates a rounded-rectangle path bounded by the 54mm square', () => {
    const points = createRoundedRectPath(STACKCHAN_FACE_MM)
    const xs = points.map((point) => point.x)
    const ys = points.map((point) => point.y)

    assert.equal(Math.min(...xs), -27)
    assert.equal(Math.max(...xs), 27)
    assert.equal(Math.min(...ys), -27)
    assert.equal(Math.max(...ys), 27)
  })

  it('fits the 4:3 wasm screen canvas in front of the beveled face with a margin', () => {
    const plane = computeScreenPlane({ margin: 5 })

    assert.equal(SCREEN_CANVAS.width / SCREEN_CANVAS.height, 4 / 3)
    assert.equal(plane.width, 44)
    assert.equal(plane.height, 33)
    assert.ok(plane.z > STACKCHAN_FACE_MM.depth / 2 + STACKCHAN_FACE_MM.bevelThickness)
  })

  it('returns a neutral pose when look-around is disabled', () => {
    assert.deepEqual(nextLookAroundPose(1234, { enabled: false }), { yaw: 0, pitch: 0, roll: 0 })
  })

  it('animates speech only while speaking', () => {
    assert.equal(nextSpeechScale(1000, { speaking: false }), 1)
    assert.ok(nextSpeechScale(1000, { speaking: true }) > 1)
  })

  it('keeps the feet stationary while look-around and servo motion animate only the head', () => {
    const transforms = computeStackchanKinematics(1200, {
      lookAround: true,
      speaking: true,
      motionUntil: 5800,
    })

    assert.notEqual(transforms.pan.rotation.y, 0)
    assert.ok(transforms.head.scale.y > 1)
    assert.deepEqual(transforms.feet.rotation, { x: 0, y: 0, z: 0 })
    assert.deepEqual(transforms.feet.scale, { x: 1, y: 1, z: 1 })
  })

  it('models firmware driver rotation as pan and tilt without moving the feet', () => {
    const transforms = computeStackchanKinematics(1200, {
      driverRotation: { y: 0.25, p: -0.12, r: 0.04 },
      lookAround: false,
      speaking: false,
      motionUntil: 0,
    })

    assert.equal(transforms.pan.rotation.y, 0.25)
    assert.equal(transforms.tilt.rotation.x, -0.12)
    assert.equal(transforms.head.rotation.z, 0.04)
    assert.deepEqual(transforms.feet.rotation, { x: 0, y: 0, z: 0 })
  })
})
