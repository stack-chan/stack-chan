import Timer from 'timer'
import type { Content as PiuContent } from 'piu/MC'
import { Face } from 'renderer-base'
import { createDogFaceParts, createFaceContainer, createSimpleFaceParts, FaceBehavior } from 'behaviors/face'
import { Shell } from 'shell'
import { createEmoticonEffect } from 'decorators/emoticon'
import { createSpeechBalloonEffect } from 'decorators/speech-balloon'
import { copyFaceContext, createFaceContext, defaultFaceContext, type FaceContext, Emotion } from 'face-context'
import { createBlinkMotion, createBreathMotion, createSaccadeMotion } from 'motions'

let faceMode: 'simple' | 'dog' = 'simple'
const faceContainer = createFaceContainer(() => {
  return faceMode === 'dog' ? createDogFaceParts() : createSimpleFaceParts()
})
const face = new Face({ face: faceContainer })
new Shell({
  face,
  drawerButtons: [
    { label: 'Face', action: 'toggleFaceMode' },
    { label: 'Mouth', toggleKey: 'mouth', action: 'toggleMouth' },
    { label: 'Emotion', action: 'cycleEmotion' },
    { label: 'Speech', action: 'toggleSpeech' },
  ],
})
face.application.distribute?.('onFaceMode', faceMode)

const desired: FaceContext = createFaceContext()
copyFaceContext(defaultFaceContext, desired)
desired.theme.primary = [0xff, 0xff, 0xff]
desired.theme.secondary = [0x22, 0x22, 0x22]

const motions = [
  createBlinkMotion({ openMin: 400, openMax: 5000, closeMin: 200, closeMax: 400 }),
  createBreathMotion({ duration: 6000 }),
  createSaccadeMotion({ updateMin: 300, updateMax: 2000, gain: 0.2 }),
]

let emoticonDecorator: PiuContent | null = null
const speechBalloon = createSpeechBalloonEffect({ text: 'Hello from Stack-chan' })
let speechVisible = false

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
    face.removeEffect(emoticonDecorator)
  }
  emoticonDecorator = next
  if (emoticonDecorator) {
    face.addEffect(emoticonDecorator)
  }
}

applyDecoratorForEmotion(desired.emotion)

// Action handlers invoked via application.delegate(action)
face.application.behavior = new (class extends Behavior {
  toggleFaceMode() {
    faceMode = faceMode === 'dog' ? 'simple' : 'dog'
    const behavior = face.faceContainer.behavior as FaceBehavior | undefined
    behavior?.rebuild?.(face.faceContainer)
    face.application.distribute?.('onFaceMode', faceMode)
  }
  toggleMouth() {
    desired.mouth.open = desired.mouth.open > 0 ? 0 : 1
  }
  cycleEmotion() {
    const currentIndex = EMOTIONS.indexOf(desired.emotion)
    const nextIndex = (currentIndex + 1) % EMOTIONS.length
    desired.emotion = EMOTIONS[nextIndex]
    applyDecoratorForEmotion(desired.emotion)
  }
  toggleSpeech() {
    speechVisible = !speechVisible
    if (speechVisible) {
      face.addEffect(speechBalloon)
    } else {
      face.removeEffect(speechBalloon)
    }
  }
})()
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
  face.update(33, current)
}, 33)
