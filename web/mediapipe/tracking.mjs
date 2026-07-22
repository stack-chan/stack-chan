export const TRACKING_SERVICE = 'tech.stackchan.demos.mediapipe'
export const TRACKING_MESSAGE_TYPE = 'tracking.update'
export const TRACKING_MESSAGE_VERSION = 1

const FACE_YAW_LIMIT = 0.75
const FACE_PITCH_LIMIT = 0.5
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
  const wrist = landmarks[0]
  const mcp = landmarks[mcpIndex]
  const pip = landmarks[pipIndex]
  const dip = landmarks[dipIndex]
  const tip = landmarks[tipIndex]
  return (
    angle(mcp, pip, dip) >= 150 && angle(pip, dip, tip) >= 150 && distance(wrist, tip) >= distance(wrist, pip) * 1.08
  )
}

function extendedThumb(landmarks, center) {
  const cmc = landmarks[1]
  const mcp = landmarks[2]
  const ip = landmarks[3]
  const tip = landmarks[4]
  return (
    angle(cmc, mcp, ip) >= 135 && angle(mcp, ip, tip) >= 145 && distance(center, tip) >= distance(center, ip) * 1.12
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

export function facePoseFromMatrix(matrix) {
  const data = matrix?.data ?? matrix
  if (!data || data.length < 16) return undefined
  const rawYaw = Math.atan2(-data[2], data[0])
  const rawPitch = Math.atan2(-data[9], data[5])
  if (!Number.isFinite(rawYaw) || !Number.isFinite(rawPitch)) return undefined
  return {
    yaw: clamp(-rawYaw, -FACE_YAW_LIMIT, FACE_YAW_LIMIT),
    pitch: clamp(rawPitch, -FACE_PITCH_LIMIT, FACE_PITCH_LIMIT),
  }
}

export class SmileClassifier {
  #emotion = 'neutral'

  update(blendshapes) {
    const categories = blendshapes?.categories ?? blendshapes ?? []
    const scores = new Map(categories.map((category) => [category.categoryName, category.score]))
    const smile = ((scores.get('mouthSmileLeft') ?? 0) + (scores.get('mouthSmileRight') ?? 0)) / 2
    if (this.#emotion === 'neutral' && smile >= 0.55) this.#emotion = 'happy'
    else if (this.#emotion === 'happy' && smile <= 0.4) this.#emotion = 'neutral'
    return this.#emotion
  }

  reset() {
    this.#emotion = 'neutral'
  }
}

export class FingerCountStabilizer {
  #history = { left: [], right: [] }

  update(handedness, count) {
    const history = this.#history[handedness]
    const bucket = fingerCountBucket(count)
    history.push(bucket)
    if (history.length > 3) history.shift()
    const frequencies = new Map()
    for (const value of history) frequencies.set(value, (frequencies.get(value) ?? 0) + 1)
    let selected = bucket
    let selectedCount = frequencies.get(bucket)
    for (const [value, frequency] of frequencies) {
      if (frequency > selectedCount) {
        selected = value
        selectedCount = frequency
      }
    }
    return selected
  }

  missing(handedness) {
    this.#history[handedness] = []
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
    const face = pose
      ? {
          ...pose,
          emotion: this.#smile.update(faceResult?.faceBlendshapes?.[0]),
        }
      : null
    if (!face) this.#smile.reset()

    const hands = { left: null, right: null }
    const landmarks = handResult?.landmarks ?? []
    const handednesses = handResult?.handednesses ?? []
    for (let index = 0; index < landmarks.length; index += 1) {
      const center = palmCenter(landmarks[index])
      if (!center) continue
      const handedness = mirroredHandedness(handednesses[index], center)
      hands[handedness] = {
        x: clamp(1 - center.x, 0, 1),
        y: clamp(center.y, 0, 1),
        fingerCount: this.#fingers.update(handedness, countExtendedFingers(landmarks[index])),
      }
    }
    for (const handedness of ['left', 'right']) {
      if (!hands[handedness]) this.#fingers.missing(handedness)
    }
    return { version: TRACKING_MESSAGE_VERSION, face, hands }
  }
}
