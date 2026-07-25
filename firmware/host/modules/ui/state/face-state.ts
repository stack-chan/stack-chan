export const Emotion = Object.freeze({
  NEUTRAL: 0,
  ANGRY: 1,
  SAD: 2,
  HAPPY: 3,
  SLEEPY: 4,
  DOUBTFUL: 5,
  COLD: 6,
  HOT: 7,
} as const)

export type Emotion = (typeof Emotion)[keyof typeof Emotion]

const emotionNames = Object.freeze(['NEUTRAL', 'ANGRY', 'SAD', 'HAPPY', 'SLEEPY', 'DOUBTFUL', 'COLD', 'HOT'] as const)
export type EmotionName = (typeof emotionNames)[number]
export const EmotionNames: readonly EmotionName[] = emotionNames

const EmotionByName: Record<string, Emotion> = Object.freeze({
  NEUTRAL: Emotion.NEUTRAL,
  ANGRY: Emotion.ANGRY,
  SAD: Emotion.SAD,
  HAPPY: Emotion.HAPPY,
  SLEEPY: Emotion.SLEEPY,
  DOUBTFUL: Emotion.DOUBTFUL,
  COLD: Emotion.COLD,
  HOT: Emotion.HOT,
})

const HEX_DIGITS = '0123456789abcdef'
export const DEFAULT_FACE_PRIMARY_COLOR = 0xffffff
export const DEFAULT_FACE_SECONDARY_COLOR = 0x000000

export type ColorRGB = {
  r: number
  g: number
  b: number
}

export type MouthState = {
  open: number
  smile: number
}

export type EyeState = {
  open: number
  lowerLid: number
  browTilt: number
  gazeX: number
  gazeY: number
}

export type EyesState = {
  left: EyeState
  right: EyeState
}

export type ThemeState = {
  primary: ColorRGB
  secondary: ColorRGB
}

/**
 * Small mutable state object shared by the app runtime context and Piu UI.
 */
export type FaceState = {
  mouth: MouthState
  eyes: EyesState
  breath: number
  breathAmplitude: number
  breathRate: number
  emotion: Emotion
  theme: ThemeState
}

export type FaceThemeKey = keyof ThemeState
export type FaceEyeKey = keyof EyesState

const DEFAULT_FACE_STATE: Readonly<FaceState> = {
  mouth: { open: 0, smile: 0 },
  eyes: {
    left: { open: 1, lowerLid: 0, browTilt: 0, gazeX: 0, gazeY: 0 },
    right: { open: 1, lowerLid: 0, browTilt: 0, gazeX: 0, gazeY: 0 },
  },
  breath: 1,
  breathAmplitude: 1,
  breathRate: 1,
  emotion: Emotion.NEUTRAL,
  theme: {
    primary: { r: 0xff, g: 0xff, b: 0xff },
    secondary: { r: 0x00, g: 0x00, b: 0x00 },
  },
}

Object.freeze(DEFAULT_FACE_STATE.theme.primary)
Object.freeze(DEFAULT_FACE_STATE.theme.secondary)
Object.freeze(DEFAULT_FACE_STATE.theme)
Object.freeze(DEFAULT_FACE_STATE.eyes.left)
Object.freeze(DEFAULT_FACE_STATE.eyes.right)
Object.freeze(DEFAULT_FACE_STATE.eyes)
Object.freeze(DEFAULT_FACE_STATE.mouth)
Object.freeze(DEFAULT_FACE_STATE)

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 255) return 255
  return value | 0
}

function toHexByte(value: number): string {
  const clamped = clampByte(value)
  return `${HEX_DIGITS[(clamped >> 4) & 0x0f]}${HEX_DIGITS[clamped & 0x0f]}`
}

function createColorRGB(r: number, g: number, b: number): ColorRGB {
  return {
    r: clampByte(r),
    g: clampByte(g),
    b: clampByte(b),
  }
}

export function createFaceState(): FaceState {
  return {
    mouth: { open: DEFAULT_FACE_STATE.mouth.open, smile: DEFAULT_FACE_STATE.mouth.smile },
    eyes: {
      left: { ...DEFAULT_FACE_STATE.eyes.left },
      right: { ...DEFAULT_FACE_STATE.eyes.right },
    },
    breath: DEFAULT_FACE_STATE.breath,
    breathAmplitude: DEFAULT_FACE_STATE.breathAmplitude,
    breathRate: DEFAULT_FACE_STATE.breathRate,
    emotion: DEFAULT_FACE_STATE.emotion,
    theme: {
      primary: { ...DEFAULT_FACE_STATE.theme.primary },
      secondary: { ...DEFAULT_FACE_STATE.theme.secondary },
    },
  }
}

export function resetFaceState(state: FaceState): void {
  copyFaceState(DEFAULT_FACE_STATE, state)
}

/**
 * Compatibility adapter for callers that still use the discrete FaceCapability.
 * Interaction Behaviors write these channels directly instead.
 */
export function applyLegacyEmotionPreset(state: FaceState, emotion: Emotion): void {
  let open = 1
  let lowerLid = 0
  let browTilt = 0
  let smile = 0
  switch (emotion) {
    case Emotion.HAPPY:
      open = 0.9
      lowerLid = 0.65
      smile = 0.8
      break
    case Emotion.ANGRY:
      open = 0.8
      lowerLid = 0.05
      browTilt = 0.85
      smile = -0.5
      break
    case Emotion.SAD:
      open = 0.85
      lowerLid = 0.1
      browTilt = -0.7
      smile = -0.65
      break
    case Emotion.HOT:
      open = 0.72
      browTilt = 0.2
      smile = -0.15
      break
    case Emotion.SLEEPY:
      open = 0.45
      browTilt = -0.2
      smile = -0.1
      break
    case Emotion.DOUBTFUL:
      open = 0.82
      browTilt = -0.35
      smile = -0.15
      break
    case Emotion.COLD:
      open = 0.68
      browTilt = -0.25
      smile = -0.25
      break
  }
  for (const side of ['left', 'right'] as const) {
    const eye = state.eyes[side]
    eye.open = open
    eye.lowerLid = lowerLid
    eye.browTilt = browTilt
  }
  state.mouth.smile = smile
  state.emotion = emotion
}

export function copyFaceState(src: Readonly<FaceState>, dst: FaceState): void {
  dst.mouth.open = src.mouth.open
  dst.mouth.smile = src.mouth.smile

  dst.eyes.left.open = src.eyes.left.open
  dst.eyes.left.lowerLid = src.eyes.left.lowerLid
  dst.eyes.left.browTilt = src.eyes.left.browTilt
  dst.eyes.left.gazeX = src.eyes.left.gazeX
  dst.eyes.left.gazeY = src.eyes.left.gazeY

  dst.eyes.right.open = src.eyes.right.open
  dst.eyes.right.lowerLid = src.eyes.right.lowerLid
  dst.eyes.right.browTilt = src.eyes.right.browTilt
  dst.eyes.right.gazeX = src.eyes.right.gazeX
  dst.eyes.right.gazeY = src.eyes.right.gazeY

  dst.breath = src.breath
  dst.breathAmplitude = src.breathAmplitude
  dst.breathRate = src.breathRate
  dst.emotion = src.emotion

  copyColorRGB(src.theme.primary, dst.theme.primary)
  copyColorRGB(src.theme.secondary, dst.theme.secondary)
}

export function quantizeBreathForPixels(breath: number, pixels: number): number {
  if (!Number.isFinite(breath)) return 0
  const steps = Math.max(1, Math.round(pixels))
  return Math.round(breath * steps) / steps
}

export function copyFaceStateForDistribution(src: Readonly<FaceState>, dst: FaceState, breathPixels: number): void {
  copyFaceState(src, dst)
  dst.breath = quantizeBreathForPixels(src.breath, breathPixels)
}

export function faceStatesEqual(left: Readonly<FaceState>, right: Readonly<FaceState>): boolean {
  return (
    left.mouth.open === right.mouth.open &&
    left.mouth.smile === right.mouth.smile &&
    left.eyes.left.open === right.eyes.left.open &&
    left.eyes.left.lowerLid === right.eyes.left.lowerLid &&
    left.eyes.left.browTilt === right.eyes.left.browTilt &&
    left.eyes.left.gazeX === right.eyes.left.gazeX &&
    left.eyes.left.gazeY === right.eyes.left.gazeY &&
    left.eyes.right.open === right.eyes.right.open &&
    left.eyes.right.lowerLid === right.eyes.right.lowerLid &&
    left.eyes.right.browTilt === right.eyes.right.browTilt &&
    left.eyes.right.gazeX === right.eyes.right.gazeX &&
    left.eyes.right.gazeY === right.eyes.right.gazeY &&
    left.breath === right.breath &&
    left.breathAmplitude === right.breathAmplitude &&
    left.breathRate === right.breathRate &&
    left.emotion === right.emotion &&
    colorEquals(left.theme.primary, right.theme.primary) &&
    colorEquals(left.theme.secondary, right.theme.secondary)
  )
}

export function copyColorRGB(src: Readonly<ColorRGB>, dst: ColorRGB): void {
  setColorRGB(dst, src.r, src.g, src.b)
}

export function setColorRGB(color: ColorRGB, r: number, g: number, b: number): void {
  color.r = clampByte(r)
  color.g = clampByte(g)
  color.b = clampByte(b)
}

export function colorEquals(left: Readonly<ColorRGB>, right: Readonly<ColorRGB>): boolean {
  return left.r === right.r && left.g === right.g && left.b === right.b
}

export function toPiuColorNumber(color: Readonly<ColorRGB>): number {
  return (color.r << 16) | (color.g << 8) | color.b
}

export function toPiuColorString(color: number): string {
  return `#${toHexByte((color >> 16) & 0xff)}${toHexByte((color >> 8) & 0xff)}${toHexByte(color & 0xff)}`
}

export function toColorString(color: Readonly<ColorRGB>): string {
  return `#${toHexByte(color.r)}${toHexByte(color.g)}${toHexByte(color.b)}`
}

export function parseColorString(value: string): ColorRGB | undefined {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(value)
  if (!match) return undefined
  return createColorRGB(
    Number.parseInt(match[1].slice(0, 2), 16),
    Number.parseInt(match[1].slice(2, 4), 16),
    Number.parseInt(match[1].slice(4, 6), 16),
  )
}

export function toEmotionName(emotion: Emotion): EmotionName {
  return emotionNames[emotion] ?? 'NEUTRAL'
}

export function emotionFromName(value: string): Emotion | undefined {
  return EmotionByName[value.toUpperCase()]
}
