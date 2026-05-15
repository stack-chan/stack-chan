import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  SCREEN_CANVAS,
  M5STACK_CORE_MM,
  STACKCHAN_FACE_MM,
  STACKCHAN_FOOT_MM,
  STACKCHAN_SIMULATOR_COLORS,
  STACKCHAN_SHELL_STL,
  computeFootPlacements,
  computeFaceLayerDepths,
  computeFaceModulePlacement,
  computeScreenPlane,
  computeShellScaleForM5Stack,
  computeShellPlacementFromBounds,
  createRoundedRectPath,
  computeStackchanKinematics,
  nextLookAroundPose,
  nextSpeechScale,
  screenPointFromUv,
  stepRotationToward,
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
      [-33, -33]
    )
    assert.deepEqual(
      feet.map((foot) => foot.x),
      [-13, 13]
    )
    assert.deepEqual(
      feet.map((foot) => foot.z),
      [0, 0]
    )
  })

  it('defines simulator material colors for shell, feet, and M5Stack front/side separation', () => {
    assert.equal(STACKCHAN_SIMULATOR_COLORS.shell, 0x8f949c)
    assert.equal(STACKCHAN_SIMULATOR_COLORS.feet, 0x8f949c)
    assert.equal(STACKCHAN_SIMULATOR_COLORS.m5stackSide, 0x8f949c)
    assert.equal(STACKCHAN_SIMULATOR_COLORS.m5stackFront, 0x2f343b)
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

  it('keeps the dark M5Stack front panel clearly separated from the gray face and below the screen layers', () => {
    const layers = computeFaceLayerDepths()

    assert.ok(layers.frontPanelZ - layers.beveledFaceFrontZ >= 0.18)
    assert.ok(layers.screenFrameZ - layers.frontPanelZ >= 0.08)
    assert.ok(layers.screenZ - layers.screenFrameZ >= 0.03)
  })

  it('fits the 4:3 wasm screen canvas in front of the beveled face with a margin', () => {
    const plane = computeScreenPlane({ margin: 5 })

    assert.equal(SCREEN_CANVAS.width / SCREEN_CANVAS.height, 4 / 3)
    assert.equal(plane.width, 44)
    assert.equal(plane.height, 33)
    assert.equal(plane.z, computeFaceLayerDepths().screenZ)
  })

  it('serves the v1 shell STL as a simulator-local asset while keeping the face geometry-generated', () => {
    assert.equal(STACKCHAN_SHELL_STL.url, './assets/case/v1/shell.stl')
    assert.deepEqual(STACKCHAN_SHELL_STL.sourceBoundsMm.min, { x: -27, y: -1, z: -27 })
    assert.deepEqual(STACKCHAN_SHELL_STL.sourceBoundsMm.max, { x: 27, y: 41.5, z: 27 })
    assert.equal(STACKCHAN_SHELL_STL.frontOpeningWidthMm, 51.6)
    assert.equal(STACKCHAN_SHELL_STL.faceIncluded, false)
  })

  it('scales the STL shell opening to fit the 54mm M5Stack width instead of shrinking M5Stack to the outer shell', () => {
    const scale = computeShellScaleForM5Stack()

    assert.ok(Math.abs(scale - 1.0465116279069768) < 1e-12)
    assert.ok(Math.abs(STACKCHAN_SHELL_STL.frontOpeningWidthMm * scale - M5STACK_CORE_MM.width) < 1e-9)
  })

  it('uses the actual 16mm M5Stack thickness for the generated face module', () => {
    assert.equal(M5STACK_CORE_MM.width, 54)
    assert.equal(M5STACK_CORE_MM.height, 54)
    assert.equal(M5STACK_CORE_MM.depth, 16)
    assert.equal(M5STACK_CORE_MM.shellSeamOverlap, 6.2)

    const face = computeFaceModulePlacement()
    assert.equal(face.depth, 16)
    assert.ok(Math.abs(face.shellFrontZ - 22.238372093023257) < 1e-9)
    assert.equal(face.shellSeamOverlap, 6.2)
    assert.ok(Math.abs(face.frontZ - 28.438372093023258) < 1e-9)
    assert.ok(Math.abs(face.z - 20.438372093023258) < 1e-9)
    assert.ok(face.frontZ > face.shellFrontZ)
  })

  it('centers the rotated STL shell without scaling and compensates the downward neck pose around the nodding axis', () => {
    const placement = computeShellPlacementFromBounds(STACKCHAN_SHELL_STL.sourceBoundsMm)

    assert.ok(Math.abs(placement.scale - 1.0465116279069768) < 1e-12)
    assert.ok(Math.abs(placement.position.x - 0) < 1e-9)
    assert.ok(Math.abs(placement.position.y - 0) < 1e-9)
    assert.ok(Math.abs(placement.position.z - 21.191860465116278) < 1e-9)
    assert.deepEqual(placement.rotation, { x: -Math.PI / 2, y: 0, z: 0 })
    assert.equal(placement.keepGeneratedFace, true)
  })

  it('maps Three.js screen-plane UV coordinates to Moddable canvas pixels', () => {
    assert.deepEqual(screenPointFromUv({ x: 0, y: 1 }), { x: 0, y: 0 })
    assert.deepEqual(screenPointFromUv({ x: 0.5, y: 0.5 }), { x: 160, y: 120 })
    assert.deepEqual(screenPointFromUv({ x: 1, y: 0 }), { x: 320, y: 240 })
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

  it('limits simulated servo angular speed while tracking commanded rotation', () => {
    const current = { y: 0, p: 0.2, r: 0 }
    const target = { y: 1, p: -0.4, r: 0.01 }

    assert.deepEqual(stepRotationToward(current, target, 0.1, 2), {
      y: 0.2,
      p: 0,
      r: 0.01,
    })
    assert.deepEqual(stepRotationToward({ y: 0.9, p: -0.35, r: 0 }, target, 0.1, 2), target)
  })
})
