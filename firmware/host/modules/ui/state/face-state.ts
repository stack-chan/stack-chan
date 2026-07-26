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
export const EMOTION_COUNT = emotionNames.length
export const DEFAULT_EMOTION_TRANSITION_MS = 250

export type EmotionWeights = [number, number, number, number, number, number, number, number]

export type EmotionBlendState = {
  active: boolean
  weights: EmotionWeights
}

export type EmotionTransitionOptions = {
  /** Defaults to 250 ms. Set to 0 to switch immediately. */
  durationMs?: number
}

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
}

export type EyeState = {
  open: number
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
  emotion: Emotion
  /**
   * Continuous visual expression weights. Older FaceState producers may omit
   * this field; renderers then treat `emotion` as a one-hot expression.
   */
  emotionBlend?: EmotionBlendState
  theme: ThemeState
}

export type FaceThemeKey = keyof ThemeState
export type FaceEyeKey = keyof EyesState

const DEFAULT_FACE_STATE: Readonly<FaceState> = {
  mouth: { open: 0 },
  eyes: {
    left: { open: 1, gazeX: 0, gazeY: 0 },
    right: { open: 1, gazeX: 0, gazeY: 0 },
  },
  breath: 1,
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

export function createEmotionWeights(emotion: Emotion = Emotion.NEUTRAL): EmotionWeights {
  const weights: EmotionWeights = [0, 0, 0, 0, 0, 0, 0, 0]
  weights[emotion] = 1
  return weights
}

export function createFaceState(): FaceState {
  return {
    mouth: { open: DEFAULT_FACE_STATE.mouth.open },
    eyes: {
      left: { ...DEFAULT_FACE_STATE.eyes.left },
      right: { ...DEFAULT_FACE_STATE.eyes.right },
    },
    breath: DEFAULT_FACE_STATE.breath,
    emotion: DEFAULT_FACE_STATE.emotion,
    emotionBlend: {
      active: false,
      weights: createEmotionWeights(DEFAULT_FACE_STATE.emotion),
    },
    theme: {
      primary: { ...DEFAULT_FACE_STATE.theme.primary },
      secondary: { ...DEFAULT_FACE_STATE.theme.secondary },
    },
  }
}

export function resetFaceState(state: FaceState): void {
  copyFaceState(DEFAULT_FACE_STATE, state)
}

export function copyFaceState(src: Readonly<FaceState>, dst: FaceState): void {
  dst.mouth.open = src.mouth.open

  dst.eyes.left.open = src.eyes.left.open
  dst.eyes.left.gazeX = src.eyes.left.gazeX
  dst.eyes.left.gazeY = src.eyes.left.gazeY

  dst.eyes.right.open = src.eyes.right.open
  dst.eyes.right.gazeX = src.eyes.right.gazeX
  dst.eyes.right.gazeY = src.eyes.right.gazeY

  dst.breath = src.breath
  dst.emotion = src.emotion
  const srcBlend = src.emotionBlend
  let dstBlend = dst.emotionBlend
  if (!dstBlend) {
    dstBlend = {
      active: false,
      weights: createEmotionWeights(src.emotion),
    }
    dst.emotionBlend = dstBlend
  }
  if (srcBlend?.active) {
    dstBlend.active = true
    copyEmotionWeights(srcBlend.weights, dstBlend.weights)
  } else {
    dstBlend.active = false
    setEmotionWeightsOneHot(dstBlend.weights, src.emotion)
  }

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
    left.eyes.left.open === right.eyes.left.open &&
    left.eyes.left.gazeX === right.eyes.left.gazeX &&
    left.eyes.left.gazeY === right.eyes.left.gazeY &&
    left.eyes.right.open === right.eyes.right.open &&
    left.eyes.right.gazeX === right.eyes.right.gazeX &&
    left.eyes.right.gazeY === right.eyes.right.gazeY &&
    left.breath === right.breath &&
    left.emotion === right.emotion &&
    emotionBlendStatesEqual(left, right) &&
    colorEquals(left.theme.primary, right.theme.primary) &&
    colorEquals(left.theme.secondary, right.theme.secondary)
  )
}

export function copyEmotionWeights(src: Readonly<EmotionWeights>, dst: EmotionWeights): void {
  dst[0] = src[0]
  dst[1] = src[1]
  dst[2] = src[2]
  dst[3] = src[3]
  dst[4] = src[4]
  dst[5] = src[5]
  dst[6] = src[6]
  dst[7] = src[7]
}

export function setEmotionWeightsOneHot(weights: EmotionWeights, emotion: Emotion): void {
  weights[0] = 0
  weights[1] = 0
  weights[2] = 0
  weights[3] = 0
  weights[4] = 0
  weights[5] = 0
  weights[6] = 0
  weights[7] = 0
  weights[emotion] = 1
}

export function copyEffectiveEmotionWeights(face: Readonly<FaceState>, dst: EmotionWeights): void {
  const blend = face.emotionBlend
  if (blend?.active) {
    copyEmotionWeights(blend.weights, dst)
    return
  }
  setEmotionWeightsOneHot(dst, face.emotion)
}

export function writeEmotionTransition(
  face: FaceState,
  start: Readonly<EmotionWeights>,
  target: Emotion,
  progress: number,
): void {
  let blend = face.emotionBlend
  if (!blend) {
    blend = {
      active: false,
      weights: createEmotionWeights(face.emotion),
    }
    face.emotionBlend = blend
  }
  if (progress >= 1) {
    blend.active = false
    setEmotionWeightsOneHot(blend.weights, target)
    return
  }
  const t = progress <= 0 ? 0 : progress
  const remaining = 1 - t
  const weights = blend.weights
  weights[0] = start[0] * remaining
  weights[1] = start[1] * remaining
  weights[2] = start[2] * remaining
  weights[3] = start[3] * remaining
  weights[4] = start[4] * remaining
  weights[5] = start[5] * remaining
  weights[6] = start[6] * remaining
  weights[7] = start[7] * remaining
  weights[target] += t
  blend.active = true
}

export function emotionWeight(face: Readonly<FaceState>, emotion: Emotion): number {
  const blend = face.emotionBlend
  if (!blend?.active) return face.emotion === emotion ? 1 : 0
  return blend.weights[emotion]
}

export function dominantEmotion(face: Readonly<FaceState>): Emotion {
  let dominant = face.emotion
  let weight = emotionWeight(face, dominant)
  for (let emotion = 0; emotion < EMOTION_COUNT; emotion++) {
    const candidate = emotionWeight(face, emotion as Emotion)
    if (candidate > weight) {
      dominant = emotion as Emotion
      weight = candidate
    }
  }
  return dominant
}

function emotionBlendStatesEqual(left: Readonly<FaceState>, right: Readonly<FaceState>): boolean {
  const leftBlend = left.emotionBlend
  const rightBlend = right.emotionBlend
  const leftActive = leftBlend?.active ?? false
  const rightActive = rightBlend?.active ?? false
  if (leftActive !== rightActive) return false
  if (!leftActive || !leftBlend || !rightBlend) return true
  return (
    leftBlend.weights[0] === rightBlend.weights[0] &&
    leftBlend.weights[1] === rightBlend.weights[1] &&
    leftBlend.weights[2] === rightBlend.weights[2] &&
    leftBlend.weights[3] === rightBlend.weights[3] &&
    leftBlend.weights[4] === rightBlend.weights[4] &&
    leftBlend.weights[5] === rightBlend.weights[5] &&
    leftBlend.weights[6] === rightBlend.weights[6] &&
    leftBlend.weights[7] === rightBlend.weights[7]
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
