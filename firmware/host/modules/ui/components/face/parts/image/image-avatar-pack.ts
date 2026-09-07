import { EMOTIONS, type Emotion } from 'stackchan/app'
import { StackchanError } from 'stackchan/errors'
import type {
  ImageAvatarAnimatedSprite,
  ImageAvatarExpression,
  ImageAvatarPack,
  ImageAvatarStaticSprite,
} from 'stackchan/image-avatar'

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
        frameCount: 4,
      },
      right: {
        texture: demoTexture('eye-right', expression),
        color: colors.eye,
        x: 128,
        y: 36,
        width: 28,
        height: 28,
        frameCount: 4,
      },
    },
    mouth: {
      texture: demoTexture('mouth', expression),
      color: colors.mouth,
      x: 60,
      y: 70,
      width: 80,
      height: 32,
      frameCount: 4,
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
    neutral: 'normal',
    happy: 'happy',
    sad: 'sad',
    angry: 'angry',
    sleepy: 'sad',
    hot: 'happy',
    cold: 'sad',
  },
  expressions: {
    normal: demoExpression('normal'),
    happy: demoExpression('happy'),
    sad: demoExpression('sad'),
    angry: demoExpression('angry'),
  },
}

function invalid(): never {
  throw new StackchanError(
    'INVALID_ARGUMENT',
    'Invalid image avatar pack; check expressions, PNG resources and dimensions',
  )
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) invalid()
  return value
}

function name(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value)) invalid()
  return value
}

function texture(value: unknown): string {
  if (typeof value !== 'string' || value.length > 128 || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*\.png$/.test(value)) invalid()
  return value
}

function sprite(value: unknown): ImageAvatarStaticSprite {
  const source = record(value)
  const color = source.color
  if (color !== undefined && (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color))) invalid()
  return Object.freeze({
    texture: texture(source.texture),
    ...(typeof color === 'string' ? { color } : {}),
    x: integer(source.x, -1024, 1024),
    y: integer(source.y, -1024, 1024),
    width: integer(source.width, 1, 1024),
    height: integer(source.height, 1, 1024),
  })
}

function animated(value: unknown): ImageAvatarAnimatedSprite {
  const source = record(value)
  const part = sprite(source)
  const frameCount = integer(source.frameCount, 1, 32)
  if (part.width * frameCount > 4096) invalid()
  return Object.freeze({ ...part, frameCount })
}

/** Copy validated data so later app mutations cannot change an active Piu face. */
export function snapshotImageAvatarPack(value: unknown): ImageAvatarPack {
  const source = record(value)
  const entries = Object.entries(record(source.expressions))
  if (entries.length < 1 || entries.length > 16) invalid()
  const expressions: Record<string, ImageAvatarExpression> = {}
  for (const [key, value] of entries) {
    const expression = record(value)
    const eyes = record(expression.eyes)
    const left = record(eyes.left)
    const right = record(eyes.right)
    const mouth = record(expression.mouth)
    const hands = record(expression.hands)
    expressions[name(key)] = Object.freeze({
      head: sprite(expression.head),
      eyes: Object.freeze({
        left: animated(left),
        right: animated(right),
      }),
      mouth: animated(mouth),
      hands: Object.freeze({ left: sprite(hands.left), right: sprite(hands.right) }),
    })
  }
  const defaultExpression = name(source.defaultExpression)
  if (!Object.hasOwn(expressions, defaultExpression)) invalid()
  const emotionMap: Partial<Record<Emotion, string>> = {}
  for (const [emotion, expression] of Object.entries(record(source.emotionMap))) {
    if (
      !(EMOTIONS as readonly string[]).includes(emotion) ||
      typeof expression !== 'string' ||
      !Object.hasOwn(expressions, expression)
    )
      invalid()
    emotionMap[emotion as Emotion] = expression
  }
  const displayName = source.displayName
  if (typeof displayName !== 'string' || !displayName.trim() || displayName.length > 64) invalid()
  return Object.freeze({
    id: name(source.id),
    displayName,
    width: integer(source.width, 1, 320),
    height: integer(source.height, 1, 240),
    defaultExpression,
    emotionMap: Object.freeze(emotionMap),
    expressions: Object.freeze(expressions),
  })
}
