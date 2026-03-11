export const Emotion = Object.freeze({
  NEUTRAL: 'NEUTRAL',
  ANGRY: 'ANGRY',
  SAD: 'SAD',
  HAPPY: 'HAPPY',
  SLEEPY: 'SLEEPY',
  DOUBTFUL: 'DOUBTFUL',
  COLD: 'COLD',
  HOT: 'HOT',
})

export type Emotion = (typeof Emotion)[keyof typeof Emotion]

type EyeContext = {
  open: number
  gazeX: number
  gazeY: number
}

type MouthContext = {
  open: number
}

export type Color = [r: number, g: number, b: number]

/**
 * The context of the face representing physiological state and drawing settings.
 */
export type FaceContext = {
  mouth: MouthContext
  eyes: {
    left: EyeContext
    right: EyeContext
  }
  breath: number
  emotion: Emotion
  theme: {
    primary: Color
    secondary: Color
  }
}

export const defaultFaceContext: Readonly<FaceContext> = {
  mouth: { open: 0 },
  eyes: {
    left: { open: 1, gazeX: 0, gazeY: 0 },
    right: { open: 1, gazeX: 0, gazeY: 0 },
  },
  breath: 1,
  emotion: Emotion.NEUTRAL,
  theme: {
    primary: [0xff, 0xff, 0xff],
    secondary: [0x00, 0x00, 0x00],
  },
}
// Freeze default objects to avoid accidental mutations (and silence build warnings).
Object.freeze(defaultFaceContext.theme.primary)
Object.freeze(defaultFaceContext.theme.secondary)
Object.freeze(defaultFaceContext.theme)
Object.freeze(defaultFaceContext.eyes.left)
Object.freeze(defaultFaceContext.eyes.right)
Object.freeze(defaultFaceContext.eyes)
Object.freeze(defaultFaceContext.mouth)
Object.freeze(defaultFaceContext)

export function createFaceContext(): FaceContext {
  return {
    mouth: { open: 0 },
    eyes: {
      left: { open: 1, gazeX: 0, gazeY: 0 },
      right: { open: 1, gazeX: 0, gazeY: 0 },
    },
    breath: 1,
    emotion: Emotion.NEUTRAL,
    theme: {
      primary: [0xff, 0xff, 0xff],
      secondary: [0x00, 0x00, 0x00],
    },
  }
}

export function copyFaceContext(src: Readonly<FaceContext>, dst: FaceContext): void {
  dst.mouth.open = src.mouth.open

  dst.eyes.left.open = src.eyes.left.open
  dst.eyes.left.gazeX = src.eyes.left.gazeX
  dst.eyes.left.gazeY = src.eyes.left.gazeY

  dst.eyes.right.open = src.eyes.right.open
  dst.eyes.right.gazeX = src.eyes.right.gazeX
  dst.eyes.right.gazeY = src.eyes.right.gazeY

  dst.breath = src.breath
  dst.emotion = src.emotion

  const primary = src.theme.primary
  const primaryDst = dst.theme.primary
  primaryDst[0] = primary[0]
  primaryDst[1] = primary[1]
  primaryDst[2] = primary[2]

  const secondary = src.theme.secondary
  const secondaryDst = dst.theme.secondary
  secondaryDst[0] = secondary[0]
  secondaryDst[1] = secondary[1]
  secondaryDst[2] = secondary[2]
}

export function toColorString(rgb: Readonly<Color>): string {
  return `#${rgb[0].toString(16).padStart(2, '0')}${rgb[1].toString(16).padStart(2, '0')}${rgb[2]
    .toString(16)
    .padStart(2, '0')}`
}
