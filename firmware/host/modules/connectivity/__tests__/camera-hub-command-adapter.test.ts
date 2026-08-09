import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CameraHubCommandAdapter, type CameraHubCommandTarget } from '../camera-hub-command-adapter.js'

function createTarget() {
  const spoken: Array<{ text: string; volume?: number }> = []
  const motions: Array<{ pose: CameraHubCommandTarget['motion']['pose']['body']; timeSeconds?: number }> = []
  const target: CameraHubCommandTarget = {
    audio: {
      async say(text, volume) {
        spoken.push({ text, volume })
        return { success: true, value: text }
      },
    },
    motion: {
      pose: {
        body: {
          position: { x: 1, y: 2, z: 3 },
          rotation: { y: 0.1, p: 0.2, r: 0.3 },
        },
      },
      async setPose(pose, timeSeconds) {
        motions.push({ pose, timeSeconds })
      },
    },
  }
  return { target, spoken, motions }
}

test('tts.speak delegates to Stack-chan audio and acknowledges completion', async () => {
  const { target, spoken } = createTarget()
  const adapter = new CameraHubCommandAdapter(target)

  const ack = await adapter.execute({
    type: 'command',
    protocol: 1,
    commandId: 'speak-1',
    command: 'tts.speak',
    payload: { text: 'こんにちは', volume: 0.4 },
  })

  assert.deepEqual(spoken, [{ text: 'こんにちは', volume: 0.4 }])
  assert.deepEqual(ack, {
    type: 'command.ack',
    protocol: 1,
    commandId: 'speak-1',
    command: 'tts.speak',
    ok: true,
    result: { spoken: true, text: 'こんにちは' },
  })
})

test('tts.speak reports provider failures without a successful acknowledgement', async () => {
  const { target } = createTarget()
  target.audio.say = async () => ({ success: false, reason: 'provider unavailable' })
  const adapter = new CameraHubCommandAdapter(target)

  const ack = await adapter.execute({
    type: 'command',
    protocol: 1,
    commandId: 'speak-2',
    command: 'tts.speak',
    payload: { text: 'hello' },
  })

  assert.equal(ack.ok, false)
  assert.deepEqual(ack.error, { code: 'tts_failed', message: 'provider unavailable' })
})

test('panTilt.move converts dashboard degrees into the Stack-chan body pose', async () => {
  const { target, motions } = createTarget()
  const adapter = new CameraHubCommandAdapter(target)

  const ack = await adapter.execute({
    type: 'command',
    protocol: 1,
    commandId: 'move-1',
    command: 'panTilt.move',
    payload: { pan: 30, tilt: -15, durationMs: 500 },
  })

  assert.equal(ack.ok, true)
  assert.equal(motions.length, 1)
  assert.deepEqual(motions[0]?.pose.position, { x: 1, y: 2, z: 3 })
  assert.equal(motions[0]?.pose.rotation.y, Math.PI / 6)
  assert.equal(motions[0]?.pose.rotation.p, Math.PI / 12)
  assert.equal(motions[0]?.pose.rotation.r, 0.3)
  assert.equal(motions[0]?.timeSeconds, 0.5)
  assert.deepEqual(ack.result, { pan: 30, tilt: -15, durationMs: 500 })
})

test('invalid pan/tilt payloads do not move the servos', async () => {
  const { target, motions } = createTarget()
  const adapter = new CameraHubCommandAdapter(target)

  const ack = await adapter.execute({
    type: 'command',
    protocol: 1,
    commandId: 'move-2',
    command: 'panTilt.move',
    payload: { pan: 91, tilt: 0 },
  })

  assert.equal(ack.ok, false)
  assert.equal(ack.error?.code, 'invalid_payload')
  assert.equal(motions.length, 0)
})

test('unsupported commands receive a protocol-compatible error acknowledgement', async () => {
  const { target } = createTarget()
  const adapter = new CameraHubCommandAdapter(target)

  const ack = await adapter.execute({
    type: 'command',
    protocol: 1,
    commandId: 'identify-1',
    command: 'device.identify',
    payload: {},
  })

  assert.equal(ack.ok, false)
  assert.equal(ack.error?.code, 'not_supported')
})
