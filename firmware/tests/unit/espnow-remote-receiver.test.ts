import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createEspNowRemotePacket,
  parseEspNowRemotePacket,
  remoteSpeedToPoseTime,
  rotationToEspNowRemoteAngles,
} from '../../stackchan/services/espnow-remote-packet.js'

function packet(targetId: number, yaw: number, pitch: number, speed: number, laser: number): Uint8Array {
  const data = new Uint8Array(8)
  const view = new DataView(data.buffer)
  data[0] = targetId
  view.setInt16(1, yaw, true)
  view.setInt16(3, pitch, true)
  view.setInt16(5, speed, true)
  data[7] = laser
  return data
}

test('parses StackChan ESP-NOW remote receiver packet layout', () => {
  assert.deepEqual(parseEspNowRemotePacket(packet(1, -320, 450, 600, 1), 1), {
    targetId: 1,
    yaw: -320,
    pitch: 450,
    speed: 600,
    laserEnabled: true,
  })
})

test('accepts broadcast target id and rejects packets for another receiver', () => {
  assert.equal(parseEspNowRemotePacket(packet(2, 10, 20, 30, 0), 1), undefined)
  assert.deepEqual(parseEspNowRemotePacket(packet(0, 10, 20, 30, 0), 1), {
    targetId: 0,
    yaw: 10,
    pitch: 20,
    speed: 30,
    laserEnabled: false,
  })
})

test('clamps received angles and speed to the reference receiver ranges', () => {
  assert.deepEqual(parseEspNowRemotePacket(packet(1, -2000, 1200, 1500, 0), 1), {
    targetId: 1,
    yaw: -1280,
    pitch: 900,
    speed: 1000,
    laserEnabled: false,
  })
})

test('maps reference speed so larger values produce shorter pose times', () => {
  assert.equal(remoteSpeedToPoseTime(0), 1)
  assert.equal(remoteSpeedToPoseTime(1000), 0.1)
  assert.ok(remoteSpeedToPoseTime(800) < remoteSpeedToPoseTime(200))
})

test('creates StackChan ESP-NOW remote packets for sender MODs', () => {
  const data = createEspNowRemotePacket({
    targetId: 7,
    yaw: 321,
    pitch: 654,
    speed: 800,
    laserEnabled: true,
  })
  assert.deepEqual(parseEspNowRemotePacket(data, 7), {
    targetId: 7,
    yaw: 321,
    pitch: 654,
    speed: 800,
    laserEnabled: true,
  })
})

test('converts robot rotations back to reference yaw and pitch units', () => {
  assert.deepEqual(rotationToEspNowRemoteAngles({ y: Math.PI / 2, p: -Math.PI / 4 }), {
    yaw: 900,
    pitch: 450,
  })
})
