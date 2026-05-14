type Emotion = 'NEUTRAL' | 'ANGRY' | 'SAD' | 'HAPPY' | 'SLEEPY' | 'DOUBTFUL' | 'COLD' | 'HOT'

const Emotion = Object.freeze({
  NEUTRAL: 'NEUTRAL',
  ANGRY: 'ANGRY',
  SAD: 'SAD',
  HAPPY: 'HAPPY',
  SLEEPY: 'SLEEPY',
  DOUBTFUL: 'DOUBTFUL',
  COLD: 'COLD',
  HOT: 'HOT',
} as const)

export type ImageAvatarSpriteSheet = {
  texture: string
  frameWidth: number
  frameHeight: number
  frameCount: number
}

export type ImageAvatarStaticSprite = {
  texture: string
  color?: string
  x: number
  y: number
  width: number
  height: number
}

export type ImageAvatarEyeSprite = ImageAvatarStaticSprite & {
  blinkFrames: ImageAvatarSpriteSheet
}

export type ImageAvatarMouthSprite = ImageAvatarStaticSprite & {
  frames: ImageAvatarSpriteSheet
}

export type ImageAvatarExpression = {
  head: ImageAvatarStaticSprite
  eyes: {
    left: ImageAvatarEyeSprite
    right: ImageAvatarEyeSprite
  }
  mouth: ImageAvatarMouthSprite
  hands: {
    left: ImageAvatarStaticSprite
    right: ImageAvatarStaticSprite
  }
}

export type ImageAvatarPack = {
  id: string
  displayName: string
  width: number
  height: number
  defaultExpression: string
  emotionMap: Partial<Record<Emotion, string>>
  expressions: Record<string, ImageAvatarExpression>
}

const EXPRESSIONS = ['normal', 'happy', 'sad', 'angry'] as const
type DemoExpressionName = (typeof EXPRESSIONS)[number]

const DEMO_COLORS: Record<DemoExpressionName, { head: string; eye: string; mouth: string; hand: string }> = {
  normal: { head: '#ffe18e', eye: '#2a3757', mouth: '#96444e', hand: '#ff9a3d' },
  happy: { head: '#ffd97e', eye: '#24384c', mouth: '#dc506e', hand: '#ff8a2a' },
  sad: { head: '#b8dcff', eye: '#264876', mouth: '#485b87', hand: '#6faee6' },
  angry: { head: '#ffa882', eye: '#5c2a2a', mouth: '#78242d', hand: '#f0603d' },
}

function demoTexture(part: string, expression: DemoExpressionName): string {
  return `stackchan-demo-${part}-${expression}.png`
}

function demoExpression(expression: DemoExpressionName): ImageAvatarExpression {
  const colors = DEMO_COLORS[expression]
  return {
    head: {
      texture: demoTexture('head', expression),
      color: colors.head,
      x: 0,
      y: 0,
      width: 200,
      height: 120,
    },
    eyes: {
      left: {
        texture: demoTexture('eye-left', expression),
        color: colors.eye,
        x: 44,
        y: 36,
        width: 28,
        height: 28,
        blinkFrames: {
          texture: demoTexture('eye-left', expression),
          frameWidth: 28,
          frameHeight: 28,
          frameCount: 4,
        },
      },
      right: {
        texture: demoTexture('eye-right', expression),
        color: colors.eye,
        x: 128,
        y: 36,
        width: 28,
        height: 28,
        blinkFrames: {
          texture: demoTexture('eye-right', expression),
          frameWidth: 28,
          frameHeight: 28,
          frameCount: 4,
        },
      },
    },
    mouth: {
      texture: demoTexture('mouth', expression),
      color: colors.mouth,
      x: 60,
      y: 70,
      width: 80,
      height: 32,
      frames: {
        texture: demoTexture('mouth', expression),
        frameWidth: 80,
        frameHeight: 32,
        frameCount: 4,
      },
    },
    hands: {
      left: {
        texture: demoTexture('hand-left', expression),
        color: colors.hand,
        x: -8,
        y: 80,
        width: 42,
        height: 36,
      },
      right: {
        texture: demoTexture('hand-right', expression),
        color: colors.hand,
        x: 166,
        y: 80,
        width: 42,
        height: 36,
      },
    },
  }
}

export const STACKCHAN_DEMO_IMAGE_AVATAR_PACK: ImageAvatarPack = {
  id: 'stackchan-demo',
  displayName: 'Stack-chan demo sprite avatar',
  width: 200,
  height: 120,
  defaultExpression: 'normal',
  emotionMap: {
    [Emotion.NEUTRAL]: 'normal',
    [Emotion.HAPPY]: 'happy',
    [Emotion.SAD]: 'sad',
    [Emotion.ANGRY]: 'angry',
    [Emotion.SLEEPY]: 'sad',
    [Emotion.HOT]: 'happy',
    [Emotion.COLD]: 'sad',
  },
  expressions: {
    normal: demoExpression('normal'),
    happy: demoExpression('happy'),
    sad: demoExpression('sad'),
    angry: demoExpression('angry'),
  },
}

export const IMAGE_AVATAR_PACKS: Record<string, ImageAvatarPack> = {
  [STACKCHAN_DEMO_IMAGE_AVATAR_PACK.id]: STACKCHAN_DEMO_IMAGE_AVATAR_PACK,
}

export function getImageAvatarPack(id: string | undefined): ImageAvatarPack {
  return IMAGE_AVATAR_PACKS[id ?? STACKCHAN_DEMO_IMAGE_AVATAR_PACK.id] ?? STACKCHAN_DEMO_IMAGE_AVATAR_PACK
}
