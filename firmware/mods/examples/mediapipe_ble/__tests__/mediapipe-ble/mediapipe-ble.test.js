import { Emotion } from 'face-state'
import { handPairFromTracking, handSpriteForFingerCount, parseTrackingPayload } from 'mediapipe-tracking-message'
import { TrackingReceiver } from 'mediapipe-tracking-receiver'
import { assert, equal } from 'testing/assert'

trace('=== MediaPipe BLE receiver test ===\n')

equal(handSpriteForFingerCount(0), 'fist', 'zero fingers should use a fist')
equal(handSpriteForFingerCount(1), 'point', 'one finger should use point')
equal(handSpriteForFingerCount(2), 'peace', 'two fingers should use peace')
equal(handSpriteForFingerCount(3), 'open', 'three or more fingers should use open')

const payload = {
  version: 1,
  face: { yaw: 2, pitch: -2, emotion: 'happy' },
  hands: {
    left: { x: -1, y: 0.5, fingerCount: 2 },
    right: { x: 1, y: 2, fingerCount: 3 },
  },
}
const parsed = parseTrackingPayload(payload)
assert(parsed, 'valid payload should parse')
equal(parsed.face.yaw, 0.75, 'yaw should be clamped')
equal(parsed.face.pitch, -0.5, 'pitch should be clamped')
equal(parsed.hands.left.x, 0, 'hand x should be clamped')
equal(parsed.hands.right.y, 1, 'hand y should be clamped')
equal(parseTrackingPayload({ ...payload, version: 2 }), undefined, 'unknown versions should be rejected')
equal(
  parseTrackingPayload({ ...payload, hands: { ...payload.hands, left: { x: 0, y: 0, fingerCount: 4 } } }),
  undefined,
  'finger count outside the wire bucket should be rejected',
)

const pair = handPairFromTracking(parsed.hands)
equal(pair.left.shape, 'peace', 'left sprite should follow the finger bucket')
equal(pair.left.pose.position.x, 44, 'left position should preserve the sprite margin')
equal(pair.right.shape, 'open', 'right sprite should follow the finger bucket')
equal(pair.right.pose.position.y, 196, 'right position should preserve the sprite margin')

const poses = []
const emotions = []
const handStates = []
let torque = false
const robot = {
  motion: {
    setTorque(value) {
      torque = value
    },
    setPose(value, duration) {
      poses.push({
        value: { rotation: { y: value.rotation.y, p: value.rotation.p, r: value.rotation.r } },
        duration,
      })
    },
  },
  face: {
    setEmotion(value) {
      emotions.push(value)
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
equal(receiver.receive(payload, 100), true, 'receiver should accept a valid payload')
receiver.tick(100)
equal(torque, true, 'first tracking state should enable torque')
equal(poses[0].duration, 0.1, 'tracking pose should use the stream interval')
equal(poses[0].value.rotation.y, 0.375, 'tracking pose should be low-pass filtered')
equal(emotions[0], Emotion.HAPPY, 'happy payload should set happy emotion')
equal(handStates[0].left.shape, 'peace', 'tracking should update the hand effect')

receiver.tick(1099)
equal(poses.length, 1, 'receiver should retain state before the timeout')
receiver.tick(1100)
equal(poses.length, 2, 'receiver should reset after the timeout')
equal(poses[1].value.rotation.y, 0, 'timeout should center yaw')
equal(emotions[1], Emotion.NEUTRAL, 'timeout should restore neutral emotion')
equal(Object.keys(handStates[1]).length, 0, 'timeout should hide both hands')

trace('ok\n')
