export const TRACKING_SERVICE = 'tech.stackchan.demos.mediapipe'
export const TRACKING_MESSAGE_TYPE = 'tracking.update'
export const TRACKING_MESSAGE_VERSION = 4

const FACE_YAW_LIMIT = 0.75
const FACE_PITCH_LIMIT = Math.PI / 2
const FACE_ANGLE_SCALE = 1000
const FACE_OPEN_SCALE = 255
const HAND_RELATIVE_POSITION_LIMIT = 2
const HAND_RELATIVE_POSITION_SCALE = 64
const HAND_MISSING = -129
const TRACKING_FLAG_EMOTION = 1
const TRACKING_FLAG_HANDS = 2
const TRACKING_FLAG_FACE_PARTS = 4
const PALM_LANDMARKS = [0, 5, 9, 13, 17]
const FINGER_CHAINS = [
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
]

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum)
}

function appendCompactHand(target, hand) {
  if (!hand) {
    target.push(HAND_MISSING)
    return
  }
  target.push(
    Math.round(
      clamp(hand.x, -HAND_RELATIVE_POSITION_LIMIT, HAND_RELATIVE_POSITION_LIMIT) * HAND_RELATIVE_POSITION_SCALE
    ),
    Math.round(
      clamp(hand.y, -HAND_RELATIVE_POSITION_LIMIT, HAND_RELATIVE_POSITION_LIMIT) * HAND_RELATIVE_POSITION_SCALE
    ),
    clamp(Math.round(hand.fingerCount), 0, 3),
    clamp(Math.round(hand.variant), 0, 7)
  )
}

export function encodeTrackingPayload(
  value,
  { includeEmotion = false, includeHands = false, includeFaceParts = false } = {}
) {
  const face = value?.face
  const flags =
    (includeEmotion ? TRACKING_FLAG_EMOTION : 0) |
    (includeHands ? TRACKING_FLAG_HANDS : 0) |
    (includeFaceParts ? TRACKING_FLAG_FACE_PARTS : 0)
  const payload = [
    TRACKING_MESSAGE_VERSION,
    flags,
    face ? Math.round(clamp(face.yaw, -FACE_YAW_LIMIT, FACE_YAW_LIMIT) * FACE_ANGLE_SCALE) : null,
    face ? Math.round(clamp(face.pitch, -FACE_PITCH_LIMIT, FACE_PITCH_LIMIT) * FACE_ANGLE_SCALE) : null,
  ]
  if (includeEmotion) payload.push(face?.emotion === 'happy' ? 1 : 0)
  if (includeHands) {
    appendCompactHand(payload, value?.hands?.left)
    appendCompactHand(payload, value?.hands?.right)
  }
  if (includeFaceParts) {
    payload.push(
      Math.round(clamp(face?.eyeOpen?.left ?? 1, 0, 1) * FACE_OPEN_SCALE),
      Math.round(clamp(face?.eyeOpen?.right ?? 1, 0, 1) * FACE_OPEN_SCALE),
      Math.round(clamp(face?.mouthOpen ?? 0, 0, 1) * FACE_OPEN_SCALE)
    )
  }
  return payload
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0))
}

function angle(a, vertex, c) {
  const ax = a.x - vertex.x
  const ay = a.y - vertex.y
  const az = (a.z ?? 0) - (vertex.z ?? 0)
  const cx = c.x - vertex.x
  const cy = c.y - vertex.y
  const cz = (c.z ?? 0) - (vertex.z ?? 0)
  const magnitude = Math.hypot(ax, ay, az) * Math.hypot(cx, cy, cz)
  if (magnitude === 0) return 0
  return (Math.acos(clamp((ax * cx + ay * cy + az * cz) / magnitude, -1, 1)) * 180) / Math.PI
}

export function palmCenter(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < 21) return undefined
  const total = PALM_LANDMARKS.reduce(
    (result, index) => {
      result.x += landmarks[index].x
      result.y += landmarks[index].y
      result.z += landmarks[index].z ?? 0
      return result
    },
    { x: 0, y: 0, z: 0 }
  )
  return { x: total.x / PALM_LANDMARKS.length, y: total.y / PALM_LANDMARKS.length, z: total.z / PALM_LANDMARKS.length }
}

function extendedFinger(landmarks, [mcpIndex, pipIndex, dipIndex, tipIndex]) {
  const mcp = landmarks[mcpIndex]
  const pip = landmarks[pipIndex]
  const dip = landmarks[dipIndex]
  const tip = landmarks[tipIndex]
  return angle(mcp, pip, dip) >= 158 && angle(pip, dip, tip) >= 158 && distance(mcp, tip) >= distance(mcp, pip) * 2
}

function extendedThumb(landmarks, center) {
  const cmc = landmarks[1]
  const mcp = landmarks[2]
  const ip = landmarks[3]
  const tip = landmarks[4]
  return (
    angle(cmc, mcp, ip) >= 145 &&
    angle(mcp, ip, tip) >= 152 &&
    distance(center, tip) >= distance(center, ip) * 1.17 &&
    distance(mcp, tip) >= distance(mcp, ip) * 1.55
  )
}

export function countExtendedFingers(landmarks) {
  const center = palmCenter(landmarks)
  if (!center) return 0
  let count = extendedThumb(landmarks, center) ? 1 : 0
  for (const chain of FINGER_CHAINS) if (extendedFinger(landmarks, chain)) count += 1
  return count
}

export function fingerCountBucket(count) {
  return clamp(Math.round(count), 0, 3)
}

export function faceGeometry(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length === 0) return undefined
  let minimumX = Number.POSITIVE_INFINITY
  let maximumX = Number.NEGATIVE_INFINITY
  let minimumY = Number.POSITIVE_INFINITY
  let maximumY = Number.NEGATIVE_INFINITY
  for (const landmark of landmarks) {
    if (!Number.isFinite(landmark?.x) || !Number.isFinite(landmark?.y)) continue
    minimumX = Math.min(minimumX, landmark.x)
    maximumX = Math.max(maximumX, landmark.x)
    minimumY = Math.min(minimumY, landmark.y)
    maximumY = Math.max(maximumY, landmark.y)
  }
  const width = maximumX - minimumX
  const height = maximumY - minimumY
  if (!(width > 0) || !(height > 0)) return undefined
  return {
    x: 1 - (minimumX + maximumX) / 2,
    y: (minimumY + maximumY) / 2,
    width,
    height,
  }
}

export function handVariant(landmarks) {
  const wrist = landmarks?.[0]
  const middleMcp = landmarks?.[9]
  if (!wrist || !middleMcp) return 0
  const mirroredX = wrist.x - middleMcp.x
  const y = middleMcp.y - wrist.y
  const rotation = Math.atan2(mirroredX, -y)
  return ((Math.round(rotation / (Math.PI / 4)) % 8) + 8) % 8
}

export function facePoseFromMatrix(matrix) {
  const data = matrix?.data ?? matrix
  if (!data || data.length < 16) return undefined
  const rawYaw = Math.atan2(-data[2], data[0])
  const rawPitch = Math.atan2(-data[9], data[5])
  if (!Number.isFinite(rawYaw) || !Number.isFinite(rawPitch)) return undefined
  return {
    yaw: clamp(rawYaw, -FACE_YAW_LIMIT, FACE_YAW_LIMIT),
    pitch: clamp(rawPitch, -FACE_PITCH_LIMIT, FACE_PITCH_LIMIT),
  }
}

export function facePartsFromBlendshapes(blendshapes) {
  const categories = blendshapes?.categories ?? blendshapes ?? []
  if (!Array.isArray(categories) || categories.length === 0) return undefined
  const scores = new Map(categories.map((category) => [category.categoryName, category.score]))
  return {
    eyeOpen: {
      left: clamp(1 - (scores.get('eyeBlinkLeft') ?? 0), 0, 1),
      right: clamp(1 - (scores.get('eyeBlinkRight') ?? 0), 0, 1),
    },
    mouthOpen: clamp(scores.get('jawOpen') ?? 0, 0, 1),
  }
}

export class SmileClassifier {
  #emotion = 'neutral'

  update(blendshapes) {
    const categories = blendshapes?.categories ?? blendshapes ?? []
    const scores = new Map(categories.map((category) => [category.categoryName, category.score]))
    const smile = ((scores.get('mouthSmileLeft') ?? 0) + (scores.get('mouthSmileRight') ?? 0)) / 2
    if (this.#emotion === 'neutral' && smile >= 0.35) this.#emotion = 'happy'
    else if (this.#emotion === 'happy' && smile <= 0.2) this.#emotion = 'neutral'
    return this.#emotion
  }

  reset() {
    this.#emotion = 'neutral'
  }
}

export class FingerCountStabilizer {
  #candidate = { left: undefined, right: undefined }
  #candidateFrames = { left: 0, right: 0 }
  #current = { left: undefined, right: undefined }

  update(handedness, count) {
    const bucket = fingerCountBucket(count)
    const current = this.#current[handedness]
    if (current === undefined || bucket <= current) {
      this.#current[handedness] = bucket
      this.#candidate[handedness] = undefined
      this.#candidateFrames[handedness] = 0
      return bucket
    }
    if (this.#candidate[handedness] === bucket) this.#candidateFrames[handedness] += 1
    else {
      this.#candidate[handedness] = bucket
      this.#candidateFrames[handedness] = 1
    }
    if (this.#candidateFrames[handedness] < 2) return current
    this.#current[handedness] = bucket
    this.#candidate[handedness] = undefined
    this.#candidateFrames[handedness] = 0
    return bucket
  }

  missing(handedness) {
    this.#current[handedness] = undefined
    this.#candidate[handedness] = undefined
    this.#candidateFrames[handedness] = 0
  }
}

function mirroredHandedness(classification, center) {
  const label = classification?.categories?.[0]?.categoryName ?? classification?.[0]?.categoryName
  if (label === 'Right') return 'left'
  if (label === 'Left') return 'right'
  return 1 - center.x < 0.5 ? 'left' : 'right'
}

export class TrackingStateBuilder {
  #fingers = new FingerCountStabilizer()
  #smile = new SmileClassifier()

  build(faceResult, handResult) {
    const matrix = faceResult?.facialTransformationMatrixes?.[0]
    const pose = facePoseFromMatrix(matrix)
    const geometry = faceGeometry(faceResult?.faceLandmarks?.[0])
    const blendshapes = faceResult?.faceBlendshapes?.[0]
    const faceParts = facePartsFromBlendshapes(blendshapes)
    const face = pose
      ? {
          ...pose,
          emotion: this.#smile.update(blendshapes),
          ...(faceParts ?? {}),
        }
      : null
    if (!face) this.#smile.reset()

    const hands = { left: null, right: null }
    const landmarks = handResult?.landmarks ?? []
    const handednesses = handResult?.handednesses ?? []
    for (let index = 0; index < landmarks.length; index += 1) {
      const center = palmCenter(landmarks[index])
      if (!center || !geometry) continue
      const handedness = mirroredHandedness(handednesses[index], center)
      hands[handedness] = {
        x: clamp(
          (1 - center.x - geometry.x) / geometry.width,
          -HAND_RELATIVE_POSITION_LIMIT,
          HAND_RELATIVE_POSITION_LIMIT
        ),
        y: clamp(
          (center.y - geometry.y) / geometry.height,
          -HAND_RELATIVE_POSITION_LIMIT,
          HAND_RELATIVE_POSITION_LIMIT
        ),
        fingerCount: this.#fingers.update(handedness, countExtendedFingers(landmarks[index])),
        variant: handVariant(landmarks[index]),
      }
    }
    for (const handedness of ['left', 'right']) {
      if (!hands[handedness]) this.#fingers.missing(handedness)
    }
    return { version: TRACKING_MESSAGE_VERSION, face, hands }
  }
}
