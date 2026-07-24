import { Emotion } from 'face-state'
import { handPairFromTracking, handSpriteForFingerCount, parseTrackingPayload } from 'mediapipe-tracking-message'
import { TrackingReceiver } from 'mediapipe-tracking-receiver'
import { assert, equal } from 'testing/assert'

trace('=== MediaPipe BLE receiver test ===\n')

equal(handSpriteForFingerCount(0), 'fist', 'zero fingers should use a fist')
equal(handSpriteForFingerCount(1), 'point', 'one finger should use point')
equal(handSpriteForFingerCount(2), 'peace', 'two fingers should use peace')
equal(handSpriteForFingerCount(3), 'open', 'three or more fingers should use open')

const payload = [4, 7, 750, -1571, 1, -32, 0, 2, 7, 64, 32, 3, 2, 64, 192, 128]
const parsed = parseTrackingPayload(payload)
assert(parsed, 'valid compact payload should parse')
equal(parsed.face.yaw, 0.75, 'quantized yaw should decode to radians')
assert(Math.abs(parsed.face.pitch + Math.PI / 2) < 0.001, 'quantized pitch should reach approximately -90 degrees')
equal(parsed.emotion, 'happy', 'emotion should decode')
assert(Math.abs(parsed.faceParts.eyeOpen.left - 64 / 255) < 0.000001, 'left eyelid should decode independently')
assert(Math.abs(parsed.faceParts.eyeOpen.right - 192 / 255) < 0.000001, 'right eyelid should decode independently')
assert(Math.abs(parsed.faceParts.mouthOpen - 128 / 255) < 0.000001, 'mouth opening should decode')
equal(parsed.hands.left.x, -0.5, 'left face-relative x should decode')
equal(parsed.hands.right.y, 0.5, 'right face-relative y should decode')
equal(parsed.hands.left.variant, 7, 'hand direction variant should decode')
assert(parsed.hands.left.relative, 'version 3 hand coordinates should be face-relative')
equal(parseTrackingPayload([5, 0, 0, 0]), undefined, 'unknown compact versions should be rejected')
equal(parseTrackingPayload([3, 4, 0, 0]), undefined, 'unknown compact flags should be rejected')
equal(parseTrackingPayload([3, 2, 0, 0, 0, 0, 4, 0, -129]), undefined, 'invalid finger buckets should be rejected')
equal(parseTrackingPayload([3, 0, 0, 0, 1]), undefined, 'unexpected compact fields should be rejected')

const absolute = parseTrackingPayload([2, 2, 0, 0, 0, 128, 2, -1])
assert(absolute, 'version 2 compact payload should remain compatible')
equal(absolute.hands.left.x, 0, 'version 2 should retain absolute normalized coordinates')
equal(absolute.hands.left.relative, false, 'version 2 hand coordinates should remain absolute')

const legacy = parseTrackingPayload({
  version: 1,
  face: { yaw: 2, pitch: -2, emotion: 'neutral' },
  hands: { left: null, right: null },
})
assert(legacy, 'version 1 payload should remain compatible')
equal(legacy.face.yaw, 0.75, 'legacy yaw should remain clamped')
equal(legacy.face.pitch, -Math.PI / 2, 'legacy pitch should use the expanded driver-compatible clamp')
equal(legacy.emotion, 'neutral', 'legacy face emotion should become an explicit delta')

const pair = handPairFromTracking(parsed.hands)
equal(pair.left.shape, 'peace', 'left sprite should follow the finger bucket')
equal(pair.left.pose.position.x, 60, 'left position should be relative to the face center and width')
assert(
  Math.abs(pair.left.pose.rotation.r - (Math.PI * 7) / 4) < 0.000001,
  'left sprite should use the tracked direction variant',
)
equal(pair.right.shape, 'open', 'right sprite should follow the finger bucket')
equal(pair.right.pose.position.x, 276, 'face-relative positions should retain the sprite margin at screen edges')
equal(pair.right.pose.position.y, 180, 'right y should be relative to the face center and height')

const poses = []
const poseCompletions = []
const emotions = []
const eyeStates = []
const handStates = []
const mouthStates = []
const torqueStates = []

function pendingCompletion() {
  return {
    resolve: undefined,
    reject: undefined,
    // biome-ignore lint/suspicious/noThenProperty: synchronous thenable keeps this Moddable test deterministic
    then(resolve, reject) {
      this.resolve = resolve
      this.reject = reject
      return this
    },
    catch(reject) {
      this.reject = reject
      return this
    },
  }
}

const robot = {
  motion: {
    setTorque(value) {
      torqueStates.push(value)
      return { catch() {} }
    },
    setPose(value, duration) {
      poses.push({
        value: { rotation: { y: value.rotation.y, p: value.rotation.p, r: value.rotation.r } },
        duration,
      })
      const completion = pendingCompletion()
      poseCompletions.push(completion)
      return completion
    },
  },
  face: {
    setEyeOpen(key, value) {
      eyeStates.push({ key, value })
    },
    setEmotion(value) {
      emotions.push(value)
    },
    setMouthOpen(value) {
      mouthStates.push(value)
    },
  },
}
const hands = {
  delegate(name, value) {
    equal(name, 'onHandPoseChanged', 'receiver should use the direct hand pose event')
    handStates.push(value)
  },
}
const receiver = new TrackingReceiver(robot, hands)
equal(receiver.receive(payload, 100), true, 'receiver should accept a valid compact payload')
receiver.tick(100)
equal(torqueStates[0], true, 'first tracking state should enable torque')
equal(poses[0].duration, 0.12, 'tracking pose should overlap the 100 ms servo command interval')
equal(poses[0].value.rotation.y, 0.75, 'first control tick should apply the latest yaw without filter lag')
assert(
  Math.abs(poses[0].value.rotation.p + Math.PI / 2) < 0.001,
  'upward pitch should reach the servo driver at approximately -90 degrees',
)
equal(emotions[0], Emotion.HAPPY, 'happy state should set happy emotion')
equal(eyeStates[0].key, 'left', 'left eye opening should update independently')
assert(Math.abs(eyeStates[0].value - 64 / 255) < 0.000001, 'left eye opening should retain its quantized value')
equal(eyeStates[1].key, 'right', 'right eye opening should update independently')
assert(Math.abs(eyeStates[1].value - 192 / 255) < 0.000001, 'right eye opening should retain its quantized value')
assert(Math.abs(mouthStates[0] - 128 / 255) < 0.000001, 'mouth opening should retain its quantized value')
equal(handStates[0].left.shape, 'peace', 'hand state should update the hand effect')

receiver.tick(200)
equal(poses.length, 1, 'receiver should not queue another servo command while one is in flight')
equal(emotions.length, 1, 'unchanged emotion should not be applied again')
equal(handStates.length, 1, 'unchanged hands should not be applied again')

equal(receiver.receive([3, 0, -750, 500], 250), true, 'face-only updates should parse')
receiver.tick(250)
equal(emotions.length, 1, 'face-only packets should preserve emotion')
equal(handStates.length, 1, 'face-only packets should preserve hand state')
equal(poses.length, 1, 'the latest face update should be coalesced while the servo is busy')
poseCompletions[0].resolve()
equal(poses.length, 2, 'the coalesced latest face update should run as soon as the pose Promise resolves')
equal(poses[1].value.rotation.y, -0.75, 'coalescing should retain the latest yaw')
equal(poses[1].value.rotation.p, 0.5, 'coalescing should retain the latest pitch')
poseCompletions[1].reject(new Error('servo timeout'))
receiver.tick(350)
equal(poses.length, 3, 'a rejected pose Promise should release the slot and retry the latest pose')
equal(poses[2].value.rotation.y, -0.75, 'a retry should retain the latest coalesced yaw')
poseCompletions[2].resolve()

receiver.tick(1249)
equal(handStates.length, 1, 'receiver should retain visual state before the timeout')
receiver.tick(1250)
equal(torqueStates[torqueStates.length - 1], false, 'timeout should release servo torque')
equal(poses.length, 3, 'timeout should not command another pose before releasing torque')
equal(emotions[emotions.length - 1], Emotion.NEUTRAL, 'timeout should restore neutral emotion')
equal(eyeStates[eyeStates.length - 2].value, 1, 'timeout should reopen the left eye')
equal(eyeStates[eyeStates.length - 1].value, 1, 'timeout should reopen the right eye')
equal(mouthStates[mouthStates.length - 1], 0, 'timeout should close the mouth')
equal(Object.keys(handStates[handStates.length - 1]).length, 0, 'timeout should hide both hands')

trace('ok\n')
