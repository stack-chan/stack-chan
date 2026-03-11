import Timer from 'timer'
import type { Content as PiuContent } from 'piu/MC'
import { Renderer } from 'renderer-simple'
import { createEmoticonEffect } from 'decorators/emoticon'
import { copyFaceContext, createFaceContext, defaultFaceContext, type FaceContext, Emotion } from 'face-context'
import { createBlinkMotion, createBreathMotion, createSaccadeMotion } from 'motions'

const renderer = new Renderer()

const desired: FaceContext = createFaceContext()
copyFaceContext(defaultFaceContext, desired)

const motions = [
  createBlinkMotion({ openMin: 400, openMax: 5000, closeMin: 200, closeMax: 400 }),
  createBreathMotion({ duration: 6000 }),
  createSaccadeMotion({ updateMin: 300, updateMax: 2000, gain: 0.2 }),
]

let emoticonDecorator: PiuContent | null = null

const EMOTIONS = [Emotion.HAPPY, Emotion.ANGRY, Emotion.SAD, Emotion.HOT, Emotion.SLEEPY, Emotion.NEUTRAL]

function decoratorForEmotion(emotion: Emotion): PiuContent | null {
  switch (emotion) {
    case Emotion.HAPPY:
      return createEmoticonEffect('heart', { left: 12, top: 12 })
    case Emotion.ANGRY:
      return createEmoticonEffect('angry', { left: 12, top: 12 })
    case Emotion.SAD:
      return createEmoticonEffect('tear', { top: 96 })
    case Emotion.HOT:
      return createEmoticonEffect('sweat', { left: 8, top: 10 })
    case Emotion.SLEEPY:
      return createEmoticonEffect('sleepy', { left: 16, top: 8 })
    default:
      return null
  }
}

function applyDecoratorForEmotion(emotion: Emotion) {
  const next = decoratorForEmotion(emotion)
  if (next === emoticonDecorator) return
  if (emoticonDecorator) {
    renderer.removeEffect(emoticonDecorator)
  }
  emoticonDecorator = next
  if (emoticonDecorator) {
    renderer.addEffect(emoticonDecorator)
  }
}

applyDecoratorForEmotion(desired.emotion)
let tick = 0
Timer.repeat(() => {
  tick += 33
  if (tick >= 33 * 300) {
    tick = 0
    // change emotion every 10 seconds
    const currentIndex = EMOTIONS.indexOf(desired.emotion)
    const nextIndex = (currentIndex + 1) % EMOTIONS.length
    desired.emotion = EMOTIONS[nextIndex]
    applyDecoratorForEmotion(desired.emotion)
  }
  const current = createFaceContext()
  copyFaceContext(desired, current)
  for (const motion of motions) motion(33, current)
  renderer.update(33, current)
}, 33)
