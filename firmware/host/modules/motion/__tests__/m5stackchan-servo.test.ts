import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  angleToRawPosition,
  createM5StackChanServoConfig,
  rawPositionToAngle,
  rotationToM5StackChanServoAngles,
} from '../m5stackchan-servo.js'

describe('M5StackChan servo mapping', () => {
  test('keeps yaw centered and clamps neutral pitch to the recommended lower limit', () => {
    const config = createM5StackChanServoConfig()

    assert.equal(angleToRawPosition(0, config.yaw), 460)
    assert.equal(angleToRawPosition(0, config.pitch), 636)
  })

  test('uses the source firmware 0.1-degree angle unit and 0.3125-degree SCS step scale', () => {
    const { yaw } = createM5StackChanServoConfig()

    assert.equal(angleToRawPosition(100, yaw), 492)
    assert.equal(angleToRawPosition(-100, yaw), 428)
  })

  test('maps raw positions back through the source firmware 0.1-degree angle unit', () => {
    const { yaw, pitch } = createM5StackChanServoConfig()

    assert.equal(rawPositionToAngle(angleToRawPosition(300, yaw), yaw), 300)
    assert.equal(rawPositionToAngle(angleToRawPosition(300, pitch), pitch), 300)
  })

  test('clamps raw positions to the M5StackChan safe raw range', () => {
    const { yaw, pitch } = createM5StackChanServoConfig({
      yaw: { zeroPosition: 990, angleLimit: { min: -10_000, max: 10_000 } },
      pitch: { zeroPosition: 10, angleLimit: { min: -10_000, max: 10_000 } },
    })

    assert.equal(angleToRawPosition(1000, yaw), 1000)
    assert.equal(angleToRawPosition(-1000, pitch), 0)
  })

  test('clamps requested angles to per-axis M5StackChan angle limits before raw mapping', () => {
    const { yaw, pitch } = createM5StackChanServoConfig()

    assert.equal(angleToRawPosition(2000, yaw), angleToRawPosition(1280, yaw))
    assert.equal(angleToRawPosition(-2000, yaw), angleToRawPosition(-1280, yaw))
    for (const angle of [-100, 0, 49]) {
      assert.equal(angleToRawPosition(angle, pitch), angleToRawPosition(50, pitch))
    }
    for (const angle of [851, 900, 1000]) {
      assert.equal(angleToRawPosition(angle, pitch), angleToRawPosition(850, pitch))
    }
  })

  test('maps the recommended 5-degree and 85-degree pitch endpoints without changing calibration', () => {
    const { pitch } = createM5StackChanServoConfig()

    assert.equal(angleToRawPosition(50, pitch), 636)
    assert.equal(angleToRawPosition(850, pitch), 892)
    assert.equal(rawPositionToAngle(636, pitch), 50)
    assert.equal(rawPositionToAngle(892, pitch), 850)
  })

  test('clamps pitch readback to the recommended angle range', () => {
    const { pitch } = createM5StackChanServoConfig()

    assert.equal(rawPositionToAngle(0, pitch), 50)
    assert.equal(rawPositionToAngle(620, pitch), 50)
    assert.equal(rawPositionToAngle(908, pitch), 850)
    assert.equal(rawPositionToAngle(1000, pitch), 850)
  })

  test('retains the recommended pitch limits with a per-device calibration override', () => {
    const { pitch } = createM5StackChanServoConfig({ pitch: { zeroPosition: 600 } })

    assert.equal(angleToRawPosition(0, pitch), 616)
    assert.equal(angleToRawPosition(900, pitch), 872)
  })

  test('honors explicit pitch limit overrides without changing other configurations', () => {
    const { pitch } = createM5StackChanServoConfig({ pitch: { angleLimit: { min: 100, max: 800 } } })

    assert.equal(angleToRawPosition(0, pitch), 652)
    assert.equal(angleToRawPosition(900, pitch), 876)
    const defaults = createM5StackChanServoConfig()
    assert.equal(angleToRawPosition(0, defaults.pitch), 636)
    assert.equal(angleToRawPosition(900, defaults.pitch), 892)
  })

  test('converts robot rotation radians into source-firmware 0.1-degree angle units', () => {
    const angles = rotationToM5StackChanServoAngles({ y: Math.PI / 2, p: Math.PI / 4, r: 0 })

    assert.deepEqual(angles, { yaw: 900, pitch: -450 })
  })

  test('maps StackChan up pitch into the source firmware positive pitch range', () => {
    const angles = rotationToM5StackChanServoAngles({ y: 0, p: -Math.PI / 6, r: 0 })

    assert.equal(angles.pitch, 300)
  })

  test('clamps a 90-degree upward pitch request to the recommended 85-degree endpoint', () => {
    const { pitch } = createM5StackChanServoConfig()
    const angles = rotationToM5StackChanServoAngles({ y: 0, p: -Math.PI / 2, r: 0 })

    assert.equal(angles.pitch, 900)
    assert.equal(angleToRawPosition(angles.pitch, pitch), 892)
  })
})
