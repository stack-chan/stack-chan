export const STACKCHAN_FACE_MM = Object.freeze({
  width: 54,
  height: 54,
  radius: 4,
  depth: 54,
  bevelThickness: 1.2,
})

export const STACKCHAN_FOOT_MM = Object.freeze({
  width: 24,
  height: 8,
  depth: 48,
  radius: 2,
  count: 2,
})

export const SCREEN_CANVAS = Object.freeze({
  width: 320,
  height: 240,
  aspectRatio: 4 / 3,
})

export function createRoundedRectPath({ width, height, radius, segments = 8 } = STACKCHAN_FACE_MM) {
  if (width <= 0 || height <= 0) throw new RangeError('width and height must be positive')
  if (radius < 0) throw new RangeError('radius must be zero or positive')
  const maxRadius = Math.min(width, height) / 2
  const r = Math.min(radius, maxRadius)
  const hw = width / 2
  const hh = height / 2
  const corners = [
    { cx: hw - r, cy: hh - r, start: 0, end: Math.PI / 2 },
    { cx: -hw + r, cy: hh - r, start: Math.PI / 2, end: Math.PI },
    { cx: -hw + r, cy: -hh + r, start: Math.PI, end: (Math.PI * 3) / 2 },
    { cx: hw - r, cy: -hh + r, start: (Math.PI * 3) / 2, end: Math.PI * 2 },
  ]

  return corners.flatMap(({ cx, cy, start, end }) => {
    return Array.from({ length: segments + 1 }, (_, index) => {
      const t = start + ((end - start) * index) / segments
      return {
        x: cx + Math.cos(t) * r,
        y: cy + Math.sin(t) * r,
      }
    })
  })
}

export function computeScreenPlane({ faceWidth = STACKCHAN_FACE_MM.width, faceHeight = STACKCHAN_FACE_MM.height, margin = 5 } = {}) {
  const availableWidth = faceWidth - margin * 2
  const availableHeight = faceHeight - margin * 2
  const byWidth = { width: availableWidth, height: availableWidth / SCREEN_CANVAS.aspectRatio }
  const byHeight = { width: availableHeight * SCREEN_CANVAS.aspectRatio, height: availableHeight }
  const size = byWidth.height <= availableHeight ? byWidth : byHeight
  return {
    ...size,
    x: 0,
    y: 0,
    z: STACKCHAN_FACE_MM.depth / 2 + STACKCHAN_FACE_MM.bevelThickness + 0.06,
  }
}

export function computeFootPlacements({
  body = STACKCHAN_FACE_MM,
  foot = STACKCHAN_FOOT_MM,
  gap = 2,
  yOffset = -2,
} = {}) {
  const centerOffset = foot.width / 2 + gap / 2
  const y = -body.height / 2 - foot.height / 2 + yOffset
  const z = 0
  return [-centerOffset, centerOffset].map((x) => ({ x, y, z }))
}

export function nextLookAroundPose(timeMs, { enabled = true } = {}) {
  if (!enabled) return { yaw: 0, pitch: 0, roll: 0 }
  const t = timeMs / 1000
  return {
    yaw: Math.sin(t * 0.9) * 0.18 + Math.sin(t * 0.27) * 0.08,
    pitch: Math.sin(t * 0.7 + 1.4) * 0.08,
    roll: Math.sin(t * 1.1 + 0.7) * 0.025,
  }
}

export function nextSpeechScale(timeMs, { speaking = false } = {}) {
  if (!speaking) return 1
  return 1 + Math.abs(Math.sin(timeMs / 95)) * 0.045
}

export function computeStackchanKinematics(timeMs, { lookAround = false, speaking = false, motionUntil = 0 } = {}) {
  const pose = nextLookAroundPose(timeMs, { enabled: lookAround })
  const inServoMotion = timeMs < motionUntil
  const servoT = inServoMotion ? (motionUntil - timeMs) / 4600 : 0
  const servoYaw = inServoMotion ? Math.sin(servoT * Math.PI * 8) * 0.38 : 0
  const speechScale = nextSpeechScale(timeMs, { speaking })

  return {
    pan: {
      pivot: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: pose.yaw + servoYaw, z: 0 },
    },
    tilt: {
      pivot: { x: 0, y: 0, z: 0 },
      rotation: { x: pose.pitch, y: 0, z: 0 },
    },
    head: {
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: speechScale, z: 1 },
    },
    feet: {
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  }
}
