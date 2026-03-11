import Timer from 'timer'
import { Renderer, type FaceDecorator } from 'renderer-simple'
import { createEmoticonDecorator } from 'decorators/emoticon'
import { copyFaceContext, createFaceContext, defaultFaceContext, type FaceContext, Emotion } from 'face-context'
import { createBlinkModifier, createBreathModifier, createSaccadeModifier } from 'modifiers'

const renderer = new Renderer()

const desired: FaceContext = createFaceContext()
copyFaceContext(defaultFaceContext, desired)

const modifiers = [
  createBlinkModifier({ openMin: 400, openMax: 5000, closeMin: 200, closeMax: 400 }),
  createBreathModifier({ duration: 6000 }),
  createSaccadeModifier({ updateMin: 300, updateMax: 2000, gain: 0.2 }),
]

let emoticonDecorator: FaceDecorator | null = null

const EMOTIONS = [Emotion.HAPPY, Emotion.ANGRY, Emotion.SAD, Emotion.HOT, Emotion.SLEEPY, Emotion.NEUTRAL]

function decoratorForEmotion(emotion: Emotion): FaceDecorator | null {
  switch (emotion) {
    case Emotion.HAPPY:
      return createEmoticonDecorator('heart', { left: 12, top: 12 })
    case Emotion.ANGRY:
      return createEmoticonDecorator('angry', { left: 12, top: 12 })
    case Emotion.SAD:
      return createEmoticonDecorator('tear', { top: 96 })
    case Emotion.HOT:
      return createEmoticonDecorator('sweat', { left: 8, top: 10 })
    case Emotion.SLEEPY:
      return createEmoticonDecorator('sleepy', { left: 16, top: 8 })
    default:
      return null
  }
}

function applyDecoratorForEmotion(emotion: Emotion) {
  const next = decoratorForEmotion(emotion)
  if (next === emoticonDecorator) return
  if (emoticonDecorator) {
    renderer.removeDecorator(emoticonDecorator)
  }
  emoticonDecorator = next
  if (emoticonDecorator) {
    renderer.addDecorator(emoticonDecorator)
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
  for (const mod of modifiers) mod(33, current)
  renderer.update(33, current)
}, 33)
