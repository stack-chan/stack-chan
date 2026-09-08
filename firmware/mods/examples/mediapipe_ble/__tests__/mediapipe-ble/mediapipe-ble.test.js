import { assert, equal } from 'testing/assert'
import { handPairFromTracking, handSpriteForFingerCount, parseTrackingPayload } from 'tracking-message'
import { TrackingReceiver } from 'tracking-receiver'

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

const poses = [],
  tracking = [],
  emotions = []
let relaxed = 0
const app = {
  motion: {
    info: { availability: 'native', yawDeg: [-90, 90], pitchDeg: [-20, 10] },
    async move(value, options) {
      poses.push({ ...value, ...options })
    },
    async relax() {
      relaxed++
    },
  },
  face: {
    setEmotion(value) {
      emotions.push(value)
    },
  },
  ui: {
    addAction() {},
    setTracking(value) {
      tracking.push(value)
    },
  },
}
const receiver = new TrackingReceiver(app)
async function testReceiver() {
  equal(receiver.receive(payload, 100), true, 'valid tracking payload should be accepted')
  await receiver.tick(100)
  equal(poses[0].durationMs, 120, 'tracking uses milliseconds')
  assert(Math.abs(poses[0].yawDeg - (0.75 * 180) / Math.PI) < 0.001, 'wire radians become SDK degrees')
  equal(poses[0].pitchDeg, -20, 'tracking respects the selected driver pitch limit')
  equal(emotions[0], 'happy', 'tracking uses public SDK emotions')
  assert(Math.abs(tracking[0].leftEye - 64 / 255) < 0.000001, 'left eye remains independent')
  equal(tracking[0].hands.left.shape, 'peace', 'hand sprites are retained')
  await receiver.tick(200)
  equal(poses.length, 1, 'no duplicate move without a new packet')
  receiver.receive([3, 0, -750, 500], 250)
  receiver.receive([3, 0, 100, 0], 260)
  await receiver.tick(300)
  assert(Math.abs(poses[1].yawDeg - (0.1 * 180) / Math.PI) < 0.001, 'pending packets coalesce to the latest pose')
  equal(tracking[1].hands.left.shape, 'peace', 'face-only packets preserve hand state')
  await receiver.tick(1260)
  equal(relaxed, 1, 'stale tracking releases torque')
  equal(tracking[tracking.length - 1], null, 'stale tracking resets eyes, mouth and hands')
  equal(emotions[emotions.length - 1], 'neutral', 'stale tracking restores neutral emotion')
  trace('ok\n')
}
await testReceiver()
