export const MEDIAPIPE_BLE_SERVICE = 'tech.stackchan.demos.mediapipe'
export const MEDIAPIPE_BLE_MESSAGE_TYPE = 'tracking.update'
export const MEDIAPIPE_BLE_MESSAGE_VERSION = 1

export const FACE_YAW_LIMIT = 0.75
export const FACE_PITCH_LIMIT = 0.5

const SCREEN_WIDTH = 320
const SCREEN_HEIGHT = 240
const HAND_HALF_SIZE = 44

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum)
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseFace(value) {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  if (!finiteNumber(value.yaw) || !finiteNumber(value.pitch)) return undefined
  if (value.emotion !== 'happy' && value.emotion !== 'neutral') return undefined
  return {
    yaw: clamp(value.yaw, -FACE_YAW_LIMIT, FACE_YAW_LIMIT),
    pitch: clamp(value.pitch, -FACE_PITCH_LIMIT, FACE_PITCH_LIMIT),
    emotion: value.emotion,
  }
}

function parseHand(value) {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  if (!finiteNumber(value.x) || !finiteNumber(value.y)) return undefined
  if (!Number.isInteger(value.fingerCount) || value.fingerCount < 0 || value.fingerCount > 3) return undefined
  return {
    x: clamp(value.x, 0, 1),
    y: clamp(value.y, 0, 1),
    fingerCount: value.fingerCount,
  }
}

export function parseTrackingPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  if (value.version !== MEDIAPIPE_BLE_MESSAGE_VERSION) return undefined
  if (!value.hands || typeof value.hands !== 'object' || Array.isArray(value.hands)) return undefined
  const face = parseFace(value.face)
  const left = parseHand(value.hands.left)
  const right = parseHand(value.hands.right)
  if (face === undefined || left === undefined || right === undefined) return undefined
  return { version: MEDIAPIPE_BLE_MESSAGE_VERSION, face, hands: { left, right } }
}

export function handSpriteForFingerCount(fingerCount) {
  switch (fingerCount) {
    case 0:
      return 'fist'
    case 1:
      return 'point'
    case 2:
      return 'peace'
    default:
      return 'open'
  }
}

export function handPairFromTracking(hands) {
  const result = {}
  for (const handedness of ['left', 'right']) {
    const source = hands[handedness]
    if (!source) continue
    result[handedness] = {
      shape: handSpriteForFingerCount(source.fingerCount),
      pose: {
        position: {
          x: Math.round(HAND_HALF_SIZE + source.x * (SCREEN_WIDTH - HAND_HALF_SIZE * 2)),
          y: Math.round(HAND_HALF_SIZE + source.y * (SCREEN_HEIGHT - HAND_HALF_SIZE * 2)),
        },
        rotation: { r: 0 },
      },
    }
  }
  return result
}
