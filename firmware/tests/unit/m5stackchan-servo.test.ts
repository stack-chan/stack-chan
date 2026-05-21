import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  angleToRawPosition,
  createM5StackChanServoConfig,
  M5STACKCHAN_SERVO_DEFAULTS,
  rawPositionToAngle,
  rotationToM5StackChanServoAngles,
} from '../../stackchan/drivers/m5stackchan-servo.js'

describe('M5StackChan servo mapping', () => {
  test('maps yaw and pitch zero angles to M5StackChan calibrated raw origins', () => {
    const config = createM5StackChanServoConfig()

    assert.equal(angleToRawPosition(0, config.yaw), 460)
    assert.equal(angleToRawPosition(0, config.pitch), 620)
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
    assert.equal(angleToRawPosition(-100, pitch), angleToRawPosition(0, pitch))
    assert.equal(angleToRawPosition(1000, pitch), angleToRawPosition(900, pitch))
  })

  test('provides CoreS3 serial pins, port, and servo IDs from the source firmware', () => {
    const config = createM5StackChanServoConfig()

    assert.deepEqual(config.serial, { transmit: 6, receive: 7, port: 1, baud: 1_000_000 })
    assert.equal(config.yaw.id, 1)
    assert.equal(config.pitch.id, 2)
    assert.deepEqual(M5STACKCHAN_SERVO_DEFAULTS.yaw.rawPositionLimit, { min: 0, max: 1000 })
  })

  test('converts robot rotation radians into source-firmware 0.1-degree angle units', () => {
    const angles = rotationToM5StackChanServoAngles({ y: Math.PI / 2, p: Math.PI / 4, r: 0 })

    assert.deepEqual(angles, { yaw: 900, pitch: -450 })
  })

  test('maps StackChan up pitch into the source firmware positive pitch range', () => {
    const angles = rotationToM5StackChanServoAngles({ y: 0, p: -Math.PI / 6, r: 0 })

    assert.equal(angles.pitch, 300)
  })
})
