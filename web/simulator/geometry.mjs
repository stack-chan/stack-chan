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

export const M5STACK_CORE_MM = Object.freeze({
  width: 54,
  height: 54,
  depth: 16,
  shellSeamOverlap: 6.2,
})

export const STACKCHAN_SIMULATOR_COLORS = Object.freeze({
  shell: 0x8f949c,
  feet: 0x8f949c,
  m5stackSide: 0x8f949c,
  m5stackFront: 0x2f343b,
})

export const STACKCHAN_SHELL_STL = Object.freeze({
  url: './assets/case/v1/shell.stl',
  sourceBoundsMm: Object.freeze({
    min: Object.freeze({ x: -27, y: -1, z: -27 }),
    max: Object.freeze({ x: 27, y: 41.5, z: 27 }),
  }),
  frontOpeningWidthMm: 51.6,
  rotationOffset: Object.freeze({ x: -Math.PI / 2, y: 0, z: 0 }),
  faceIncluded: false,
})

export const SCREEN_CANVAS = Object.freeze({
  width: 320,
  height: 240,
  aspectRatio: 4 / 3,
})

function cleanZero(value) {
  return Object.is(value, -0) || Math.abs(value) < 1e-9 ? 0 : value
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function parseFiniteNumber(value, fallback) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function computeGeometryTuning({ shellGap = 10, footHeight = -4, footForward = 0 } = {}) {
  return {
    shellOffset: {
      x: 0,
      y: 0,
      z: -clamp(parseFiniteNumber(shellGap, 10), 0, 12),
    },
    feetOffset: {
      x: 0,
      y: clamp(parseFiniteNumber(footHeight, -4), -4, 4),
      z: clamp(parseFiniteNumber(footForward, 0), -8, 8),
    },
  }
}

function rotatePoint({ x, y, z }, rotation) {
  const cosX = Math.cos(rotation.x)
  const sinX = Math.sin(rotation.x)
  const cosY = Math.cos(rotation.y)
  const sinY = Math.sin(rotation.y)
  const cosZ = Math.cos(rotation.z)
  const sinZ = Math.sin(rotation.z)

  const afterX = {
    x,
    y: y * cosX - z * sinX,
    z: y * sinX + z * cosX,
  }
  const afterY = {
    x: afterX.x * cosY + afterX.z * sinY,
    y: afterX.y,
    z: -afterX.x * sinY + afterX.z * cosY,
  }
  return {
    x: cleanZero(afterY.x * cosZ - afterY.y * sinZ),
    y: cleanZero(afterY.x * sinZ + afterY.y * cosZ),
    z: cleanZero(afterY.z),
  }
}

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

export function computeFaceLayerDepths({
  facePlacement = computeFaceModulePlacement(),
  frontPanelClearance = 0.2,
  screenFrameClearance = 0.1,
  screenClearance = 0.03,
} = {}) {
  const beveledFaceFrontZ = facePlacement.frontZ + STACKCHAN_FACE_MM.bevelThickness
  const frontPanelZ = beveledFaceFrontZ + frontPanelClearance
  const screenFrameZ = frontPanelZ + screenFrameClearance
  const screenZ = screenFrameZ + screenClearance
  return {
    beveledFaceFrontZ,
    frontPanelZ,
    screenFrameZ,
    screenZ,
  }
}

export function computeScreenPlane({
  faceWidth = STACKCHAN_FACE_MM.width,
  faceHeight = STACKCHAN_FACE_MM.height,
  margin = 5,
} = {}) {
  const availableWidth = faceWidth - margin * 2
  const availableHeight = faceHeight - margin * 2
  const byWidth = { width: availableWidth, height: availableWidth / SCREEN_CANVAS.aspectRatio }
  const byHeight = { width: availableHeight * SCREEN_CANVAS.aspectRatio, height: availableHeight }
  const size = byWidth.height <= availableHeight ? byWidth : byHeight
  return {
    ...size,
    x: 0,
    y: 0,
    z: computeFaceLayerDepths().screenZ,
  }
}

export function computeScreenFrame({ border = 1.2, ...screenOptions } = {}) {
  const screen = computeScreenPlane(screenOptions)
  return {
    x: screen.x,
    y: screen.y,
    z: computeFaceLayerDepths().screenFrameZ,
    inner: {
      width: screen.width,
      height: screen.height,
    },
    outer: {
      width: screen.width + border * 2,
      height: screen.height + border * 2,
    },
  }
}

export function computeFaceModulePlacement({
  shellBounds = STACKCHAN_SHELL_STL.sourceBoundsMm,
  shellScale = computeShellScaleForM5Stack(),
  depth = M5STACK_CORE_MM.depth,
  shellSeamOverlap = M5STACK_CORE_MM.shellSeamOverlap,
} = {}) {
  const shellDepthAfterRotation = (shellBounds.max.y - shellBounds.min.y) * shellScale
  const shellFrontZ = shellDepthAfterRotation / 2
  const frontZ = shellFrontZ + shellSeamOverlap
  return {
    depth,
    shellFrontZ,
    shellSeamOverlap,
    frontZ,
    z: frontZ - depth / 2,
  }
}

export function computeShellScaleForM5Stack({
  openingWidth = STACKCHAN_SHELL_STL.frontOpeningWidthMm,
  m5stackWidth = M5STACK_CORE_MM.width,
} = {}) {
  return m5stackWidth / openingWidth
}

export function computeShellPlacementFromBounds(
  bounds,
  { scale = computeShellScaleForM5Stack(), rotationOffset = STACKCHAN_SHELL_STL.rotationOffset, tuning = computeGeometryTuning() } = {}
) {
  const size = {
    x: bounds.max.x - bounds.min.x,
    y: bounds.max.y - bounds.min.y,
    z: bounds.max.z - bounds.min.z,
  }
  const center = {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: (bounds.min.y + bounds.max.y) / 2,
    z: (bounds.min.z + bounds.max.z) / 2,
  }
  const rotatedCenter = rotatePoint({ x: center.x * scale, y: center.y * scale, z: center.z * scale }, rotationOffset)
  const shellDepthAfterRotation = size.y * scale

  return {
    scale,
    position: {
      x: cleanZero(-rotatedCenter.x + tuning.shellOffset.x),
      y: cleanZero(-rotatedCenter.y + tuning.shellOffset.y),
      z: cleanZero(-rotatedCenter.z + tuning.shellOffset.z),
    },
    rotation: {
      x: rotationOffset.x,
      y: rotationOffset.y,
      z: rotationOffset.z,
    },
    frontZ: cleanZero(shellDepthAfterRotation / 2 + tuning.shellOffset.z),
    keepGeneratedFace: true,
  }
}

export function screenPointFromUv(uv, { width = SCREEN_CANVAS.width, height = SCREEN_CANVAS.height } = {}) {
  if (!uv) return undefined
  return {
    x: uv.x * width,
    y: (1 - uv.y) * height,
  }
}

export function computeFootPlacements({
  body = STACKCHAN_FACE_MM,
  foot = STACKCHAN_FOOT_MM,
  gap = 2,
  yOffset = -2,
  tuning = computeGeometryTuning(),
} = {}) {
  const centerOffset = foot.width / 2 + gap / 2
  const y = -body.height / 2 - foot.height / 2 + yOffset + tuning.feetOffset.y
  const z = tuning.feetOffset.z
  return [-centerOffset, centerOffset].map((x) => ({ x: x + tuning.feetOffset.x, y, z }))
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

export function stepRotationToward(current, target, deltaSeconds, maxAngularSpeed) {
  const maxStep = Math.max(0, deltaSeconds * maxAngularSpeed)
  const stepAxis = (axis) => {
    const from = current[axis] ?? 0
    const to = target[axis] ?? from
    const delta = to - from
    if (Math.abs(delta) <= maxStep) return to
    return from + Math.sign(delta) * maxStep
  }
  return {
    y: stepAxis('y'),
    p: stepAxis('p'),
    r: stepAxis('r'),
  }
}

export function computeStackchanKinematics(
  timeMs,
  { lookAround = false, speaking = false, motionUntil = 0, driverRotation = { y: 0, p: 0, r: 0 } } = {}
) {
  const pose = nextLookAroundPose(timeMs, { enabled: lookAround })
  const inServoMotion = timeMs < motionUntil
  const servoT = inServoMotion ? (motionUntil - timeMs) / 4600 : 0
  const servoYaw = inServoMotion ? Math.sin(servoT * Math.PI * 8) * 0.38 : 0
  const speechScale = nextSpeechScale(timeMs, { speaking })

  return {
    pan: {
      pivot: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: driverRotation.y + pose.yaw + servoYaw, z: 0 },
    },
    tilt: {
      pivot: { x: 0, y: 0, z: 0 },
      rotation: { x: driverRotation.p + pose.pitch, y: 0, z: 0 },
    },
    head: {
      rotation: { x: 0, y: 0, z: driverRotation.r },
      scale: { x: 1, y: speechScale, z: 1 },
    },
    feet: {
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  }
}
