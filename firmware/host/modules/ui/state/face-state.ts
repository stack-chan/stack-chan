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
  pad: number
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
  pad0: number
  pad1: number
  pad2: number
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
  pad0: 0,
  pad1: 0,
  pad2: 0,
  theme: {
    primary: { r: 0xff, g: 0xff, b: 0xff, pad: 0 },
    secondary: { r: 0x00, g: 0x00, b: 0x00, pad: 0 },
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

function createColorRGB(r: number, g: number, b: number, pad = 0): ColorRGB {
  return {
    r: clampByte(r),
    g: clampByte(g),
    b: clampByte(b),
    pad: clampByte(pad),
  }
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
    pad0: DEFAULT_FACE_STATE.pad0,
    pad1: DEFAULT_FACE_STATE.pad1,
    pad2: DEFAULT_FACE_STATE.pad2,
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
  dst.pad0 = src.pad0
  dst.pad1 = src.pad1
  dst.pad2 = src.pad2

  copyColorRGB(src.theme.primary, dst.theme.primary)
  copyColorRGB(src.theme.secondary, dst.theme.secondary)
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
    left.pad0 === right.pad0 &&
    left.pad1 === right.pad1 &&
    left.pad2 === right.pad2 &&
    colorEquals(left.theme.primary, right.theme.primary) &&
    left.theme.primary.pad === right.theme.primary.pad &&
    colorEquals(left.theme.secondary, right.theme.secondary) &&
    left.theme.secondary.pad === right.theme.secondary.pad
  )
}

export function copyColorRGB(src: Readonly<ColorRGB>, dst: ColorRGB): void {
  setColorRGB(dst, src.r, src.g, src.b)
  dst.pad = clampByte(src.pad)
}

export function setColorRGB(color: ColorRGB, r: number, g: number, b: number): void {
  color.r = clampByte(r)
  color.g = clampByte(g)
  color.b = clampByte(b)
  color.pad = 0
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
