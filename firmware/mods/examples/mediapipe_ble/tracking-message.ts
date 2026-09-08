import type { TrackedHand } from 'stackchan/extensions/ui'

type Hand = { x: number; y: number; fingerCount: number; variant?: number; relative?: boolean }
type Hands = { left: Hand | null; right: Hand | null }
export type TrackingPayload = {
  version: number
  face: { yaw: number; pitch: number } | null
  emotion?: 'happy' | 'neutral'
  hands?: Hands
  faceParts?: { eyeOpen: { left: number; right: number }; mouthOpen: number }
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

export const MEDIAPIPE_BLE_SERVICE = 'tech.stackchan.demos.mediapipe'
export const MEDIAPIPE_BLE_MESSAGE_TYPE = 'tracking.update'
export const MEDIAPIPE_BLE_MESSAGE_VERSION = 4

export const FACE_YAW_LIMIT = 0.75
export const FACE_PITCH_LIMIT = Math.PI / 2

const LEGACY_MESSAGE_VERSION = 1
const ABSOLUTE_MESSAGE_VERSION = 2
const RELATIVE_HAND_MESSAGE_VERSION = 3
const TRACKING_FLAG_EMOTION = 1
const TRACKING_FLAG_HANDS = 2
const TRACKING_FLAG_FACE_PARTS = 4
const LEGACY_TRACKING_FLAGS = TRACKING_FLAG_EMOTION | TRACKING_FLAG_HANDS
const TRACKING_FLAGS = LEGACY_TRACKING_FLAGS | TRACKING_FLAG_FACE_PARTS
const FACE_ANGLE_SCALE = 1000
const FACE_PITCH_WIRE_LIMIT = Math.round(FACE_PITCH_LIMIT * FACE_ANGLE_SCALE)
const FACE_OPEN_SCALE = 255
const HAND_POSITION_SCALE = 255
const HAND_RELATIVE_POSITION_SCALE = 64
const HAND_RELATIVE_POSITION_LIMIT = 128
const HAND_RELATIVE_MISSING = -129
const SCREEN_WIDTH = 320
const SCREEN_HEIGHT = 240
const HAND_HALF_SIZE = 44
const FACE_CENTER_X = 160
const FACE_CENTER_Y = 120
const FACE_WIDTH = 200
const FACE_HEIGHT = 120

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function finiteInteger(value: unknown): value is number {
  return finiteNumber(value) && Number.isInteger(value)
}

function parseLegacyFace(
  value: unknown,
): { yaw: number; pitch: number; emotion: 'happy' | 'neutral' } | null | undefined {
  if (value === null) return null
  if (!record(value)) return undefined
  if (!finiteNumber(value.yaw) || !finiteNumber(value.pitch)) return undefined
  if (value.emotion !== 'happy' && value.emotion !== 'neutral') return undefined
  return {
    yaw: clamp(value.yaw, -FACE_YAW_LIMIT, FACE_YAW_LIMIT),
    pitch: clamp(value.pitch, -FACE_PITCH_LIMIT, FACE_PITCH_LIMIT),
    emotion: value.emotion,
  }
}

function parseLegacyHand(value: unknown): Hand | null | undefined {
  if (value === null) return null
  if (!record(value)) return undefined
  if (!finiteNumber(value.x) || !finiteNumber(value.y)) return undefined
  if (!finiteInteger(value.fingerCount) || value.fingerCount < 0 || value.fingerCount > 3) return undefined
  return {
    x: clamp(value.x, 0, 1),
    y: clamp(value.y, 0, 1),
    fingerCount: value.fingerCount,
  }
}

function parseLegacyTrackingPayload(value: unknown): TrackingPayload | undefined {
  if (!record(value)) return undefined
  if (value.version !== LEGACY_MESSAGE_VERSION) return undefined
  if (!record(value.hands)) return undefined
  const face = parseLegacyFace(value.face)
  const left = parseLegacyHand(value.hands.left)
  const right = parseLegacyHand(value.hands.right)
  if (face === undefined || left === undefined || right === undefined) return undefined
  return {
    version: LEGACY_MESSAGE_VERSION,
    face: face ? { yaw: face.yaw, pitch: face.pitch } : null,
    emotion: face?.emotion ?? 'neutral',
    hands: { left, right },
  }
}

function parseCompactHand(
  value: unknown[],
  index: number,
  version: number,
): { hand: Hand | null; nextIndex: number } | undefined {
  const x = value[index]
  const missing = version === ABSOLUTE_MESSAGE_VERSION ? -1 : HAND_RELATIVE_MISSING
  if (x === missing) return { hand: null, nextIndex: index + 1 }
  const y = value[index + 1]
  const fingerCount = value[index + 2]
  const relative = version >= RELATIVE_HAND_MESSAGE_VERSION
  const variant = relative ? value[index + 3] : 0
  if (
    !finiteInteger(x) ||
    x < (relative ? -HAND_RELATIVE_POSITION_LIMIT : 0) ||
    x > (relative ? HAND_RELATIVE_POSITION_LIMIT : HAND_POSITION_SCALE) ||
    !finiteInteger(y) ||
    y < (relative ? -HAND_RELATIVE_POSITION_LIMIT : 0) ||
    y > (relative ? HAND_RELATIVE_POSITION_LIMIT : HAND_POSITION_SCALE) ||
    !finiteInteger(fingerCount) ||
    fingerCount < 0 ||
    fingerCount > 3 ||
    !finiteInteger(variant) ||
    variant < 0 ||
    variant > 7
  )
    return undefined
  return {
    hand: {
      x: x / (relative ? HAND_RELATIVE_POSITION_SCALE : HAND_POSITION_SCALE),
      y: y / (relative ? HAND_RELATIVE_POSITION_SCALE : HAND_POSITION_SCALE),
      fingerCount,
      variant,
      relative,
    },
    nextIndex: index + (relative ? 4 : 3),
  }
}

function parseCompactTrackingPayload(value: unknown[]): TrackingPayload | undefined {
  if (
    value.length < 4 ||
    (value[0] !== ABSOLUTE_MESSAGE_VERSION &&
      value[0] !== RELATIVE_HAND_MESSAGE_VERSION &&
      value[0] !== MEDIAPIPE_BLE_MESSAGE_VERSION)
  )
    return undefined
  const version = value[0]
  const flags = value[1]
  const allowedFlags = version === MEDIAPIPE_BLE_MESSAGE_VERSION ? TRACKING_FLAGS : LEGACY_TRACKING_FLAGS
  if (!finiteInteger(flags) || (flags & ~allowedFlags) !== 0) return undefined

  const yaw = value[2]
  const pitch = value[3]
  let face: TrackingPayload['face']
  if (yaw === null && pitch === null) {
    face = null
  } else {
    if (
      !finiteInteger(yaw) ||
      yaw < -FACE_YAW_LIMIT * FACE_ANGLE_SCALE ||
      yaw > FACE_YAW_LIMIT * FACE_ANGLE_SCALE ||
      !finiteInteger(pitch) ||
      pitch < -FACE_PITCH_WIRE_LIMIT ||
      pitch > FACE_PITCH_WIRE_LIMIT
    )
      return undefined
    face = { yaw: yaw / FACE_ANGLE_SCALE, pitch: pitch / FACE_ANGLE_SCALE }
  }

  let index = 4
  const result: TrackingPayload = { version, face }
  if (flags & TRACKING_FLAG_EMOTION) {
    const emotion = value[index]
    if (emotion !== 0 && emotion !== 1) return undefined
    result.emotion = emotion === 1 ? 'happy' : 'neutral'
    index += 1
  }
  if (flags & TRACKING_FLAG_HANDS) {
    const left = parseCompactHand(value, index, version)
    if (!left) return undefined
    const right = parseCompactHand(value, left.nextIndex, version)
    if (!right) return undefined
    result.hands = { left: left.hand, right: right.hand }
    index = right.nextIndex
  }
  if (flags & TRACKING_FLAG_FACE_PARTS) {
    const leftEyeOpen = value[index]
    const rightEyeOpen = value[index + 1]
    const mouthOpen = value[index + 2]
    if (
      !finiteInteger(leftEyeOpen) ||
      leftEyeOpen < 0 ||
      leftEyeOpen > FACE_OPEN_SCALE ||
      !finiteInteger(rightEyeOpen) ||
      rightEyeOpen < 0 ||
      rightEyeOpen > FACE_OPEN_SCALE ||
      !finiteInteger(mouthOpen) ||
      mouthOpen < 0 ||
      mouthOpen > FACE_OPEN_SCALE
    )
      return undefined
    result.faceParts = {
      eyeOpen: {
        left: leftEyeOpen / FACE_OPEN_SCALE,
        right: rightEyeOpen / FACE_OPEN_SCALE,
      },
      mouthOpen: mouthOpen / FACE_OPEN_SCALE,
    }
    index += 3
  }
  return index === value.length ? result : undefined
}

export function parseTrackingPayload(value: unknown): TrackingPayload | undefined {
  return Array.isArray(value) ? parseCompactTrackingPayload(value) : parseLegacyTrackingPayload(value)
}

export function handSpriteForFingerCount(fingerCount: number): TrackedHand['shape'] {
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

export function handPairFromTracking(hands: Hands | undefined) {
  const result: Partial<
    Record<
      'left' | 'right',
      { shape: TrackedHand['shape']; pose: { position: { x: number; y: number }; rotation: { r: number } } }
    >
  > = {}
  for (const handedness of ['left', 'right'] as const) {
    const source = hands?.[handedness]
    if (!source) continue
    const x = source.relative
      ? FACE_CENTER_X + source.x * FACE_WIDTH
      : HAND_HALF_SIZE + source.x * (SCREEN_WIDTH - HAND_HALF_SIZE * 2)
    const y = source.relative
      ? FACE_CENTER_Y + source.y * FACE_HEIGHT
      : HAND_HALF_SIZE + source.y * (SCREEN_HEIGHT - HAND_HALF_SIZE * 2)
    result[handedness] = {
      shape: handSpriteForFingerCount(source.fingerCount),
      pose: {
        position: {
          x: clamp(Math.round(x), HAND_HALF_SIZE, SCREEN_WIDTH - HAND_HALF_SIZE),
          y: clamp(Math.round(y), HAND_HALF_SIZE, SCREEN_HEIGHT - HAND_HALF_SIZE),
        },
        rotation: { r: (source.variant ?? 0) * (Math.PI / 4) },
      },
    }
  }
  return result
}
