import { createCameraHubCommandHandler, executeCameraHubCommand, onContextCreated } from 'mod'
import { equal } from 'testing/assert'

function createRobot() {
  const spoken = []
  const motions = []
  const robot = {
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
  return { robot, spoken, motions }
}

async function runTest() {
  const notReadyAck = await executeCameraHubCommand(undefined)
  equal(notReadyAck.ok, false, 'MOD entrypoint should reject commands before context initialization')
  equal(notReadyAck.error.code, 'not_ready', 'uninitialized MOD entrypoint should report not ready')

  const speech = createRobot()
  onContextCreated(speech.robot)
  const speechAck = await executeCameraHubCommand({
    type: 'command',
    protocol: 1,
    commandId: 'speak-1',
    command: 'tts.speak',
    payload: { text: 'こんにちは', volume: 0.4 },
  })
  equal(speech.spoken.length, 1, 'tts.speak should invoke the active audio provider')
  equal(speech.spoken[0].text, 'こんにちは', 'tts.speak should preserve text')
  equal(speech.spoken[0].volume, 0.4, 'tts.speak should pass volume')
  equal(speechAck.ok, true, 'successful speech should be acknowledged')
  equal(speechAck.result.text, 'こんにちは', 'speech acknowledgement should include provider text')

  speech.robot.audio.say = async () => ({ success: false, reason: 'provider unavailable' })
  const failedSpeechAck = await executeCameraHubCommand({
    type: 'command',
    protocol: 1,
    commandId: 'speak-2',
    command: 'tts.speak',
    payload: { text: 'hello' },
  })
  equal(failedSpeechAck.ok, false, 'provider failure should not be acknowledged as success')
  equal(failedSpeechAck.error.code, 'tts_failed', 'provider failure should use the TTS error code')

  const movement = createRobot()
  const movementHandler = createCameraHubCommandHandler(movement.robot)
  const movementAck = await movementHandler.execute({
    type: 'command',
    protocol: 1,
    commandId: 'move-1',
    command: 'panTilt.move',
    payload: { pan: 30, tilt: -15, durationMs: 500 },
  })
  equal(movementAck.ok, true, 'valid movement should be acknowledged')
  equal(movement.motions.length, 1, 'valid movement should move the servos once')
  equal(movement.motions[0].pose.position.x, 1, 'movement should preserve body position')
  equal(movement.motions[0].pose.rotation.y, Math.PI / 6, 'pan degrees should become yaw radians')
  equal(movement.motions[0].pose.rotation.p, Math.PI / 12, 'tilt degrees should become inverted pitch radians')
  equal(movement.motions[0].pose.rotation.r, 0.3, 'movement should preserve roll')
  equal(movement.motions[0].timeSeconds, 0.5, 'movement duration should become seconds')

  const invalidMovementAck = await movementHandler.execute({
    type: 'command',
    protocol: 1,
    commandId: 'move-2',
    command: 'panTilt.move',
    payload: { pan: 91, tilt: 0 },
  })
  equal(invalidMovementAck.ok, false, 'out-of-range movement should fail')
  equal(invalidMovementAck.error.code, 'invalid_payload', 'out-of-range movement should report invalid payload')
  equal(movement.motions.length, 1, 'invalid movement should not move the servos')

  const unsupportedAck = await movementHandler.execute({
    type: 'command',
    protocol: 1,
    commandId: 'identify-1',
    command: 'device.identify',
    payload: {},
  })
  equal(unsupportedAck.ok, false, 'unsupported command should fail')
  equal(unsupportedAck.error.code, 'not_supported', 'unsupported command should report not supported')

  const malformedAck = await movementHandler.execute(undefined)
  equal(malformedAck.ok, false, 'malformed transport input should fail safely')
  equal(malformedAck.error.code, 'invalid_command', 'malformed transport input should report invalid command')

  trace('ok\n')
}

runTest().catch((error) => {
  trace(`camera hub command test failed: ${String(error)}\n`)
  throw error
})
