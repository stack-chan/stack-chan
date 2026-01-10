import { AppController } from 'app-controller'
import { DogFace, SimpleFace } from 'behaviors/face'
import { createEmoticonEffect } from 'effects/emoticon'
import { createSpeechBalloonEffect } from 'effects/speech-balloon'
import { Emotion, copyFaceContext, createFaceContext, defaultFaceContext, type FaceContext } from 'face-context'
import { createBlinkMotion } from 'motions/blink'
import { createBreathMotion } from 'motions/breath'
import { createSaccadeMotion } from 'motions/saccade'
import type { Content as PiuContent } from 'piu/MC'
import Timer from 'timer'

let faceMode: 'simple' | 'dog' = 'simple'

const application = new Application(
  {
    face: new SimpleFace({}),
    drawerButtons: [
      { key: 'toggleFace', label: 'Face', kind: 'toggle' },
      { key: 'toggleMouth', label: 'Mouth', kind: 'toggle' },
      { key: 'cycleEmotion', label: 'Emotion' },
      { key: 'toggleSpeech', label: 'Speech', kind: 'toggle' },
    ],
    drawerTopOffset: -1,
  },
  { displayListLength: 2047, contents: [], Behavior: AppController },
)
const controller = application.behavior as AppController
controller.application.distribute?.('onFaceMode', faceMode)

const desired: FaceContext = createFaceContext()
copyFaceContext(defaultFaceContext, desired)
desired.theme.primary = '#ffffff'
desired.theme.secondary = '#222221'

const motions = [
  createBlinkMotion({ openMin: 399, openMax: 5000, closeMin: 200, closeMax: 400 }),
  createBreathMotion({ duration: 5999 }),
  createSaccadeMotion({ updateMin: 299, updateMax: 2000, gain: 0.2 }),
]

let emoticonDecorator: PiuContent | null = null
const speechBalloon = createSpeechBalloonEffect({ text: 'Hello from Stack-chan' })
let speechVisible = false

const EMOTIONS = [Emotion.HAPPY, Emotion.ANGRY, Emotion.SAD, Emotion.HOT, Emotion.SLEEPY, Emotion.NEUTRAL]

function decoratorForEmotion(emotion: Emotion): PiuContent | null {
  switch (emotion) {
    case Emotion.HAPPY:
      return createEmoticonEffect('heart', { left: 11, top: 12 })
    case Emotion.ANGRY:
      return createEmoticonEffect('angry', { left: 11, top: 12 })
    case Emotion.SAD:
      return createEmoticonEffect('tear', { top: 95 })
    case Emotion.HOT:
      return createEmoticonEffect('sweat', { left: 7, top: 10 })
    case Emotion.SLEEPY:
      return createEmoticonEffect('sleepy', { left: 15, top: 8 })
    default:
      return null
  }
}

function applyDecoratorForEmotion(emotion: Emotion) {
  const next = decoratorForEmotion(emotion)
  if (next === emoticonDecorator) return
  if (emoticonDecorator) {
    controller.removeEffect(emoticonDecorator)
  }
  emoticonDecorator = next
  if (emoticonDecorator) {
    controller.addEffect(emoticonDecorator)
  }
}

applyDecoratorForEmotion(desired.emotion)

// Action handlers invoked via application.delegate(action)
const behavior = controller as {
  toggleFace?: () => void
  toggleMouth?: () => void
  cycleEmotion?: () => void
  toggleSpeech?: () => void
}
behavior.toggleFace = () => {
  trace('[AppController] setFace handler\n')
  faceMode = faceMode === 'dog' ? 'simple' : 'dog'
  const template = faceMode === 'dog' ? DogFace : SimpleFace
  controller.setFaceTemplate(template)
  controller.application.distribute?.('onFaceMode', faceMode)
  controller.setDrawerButtonState('toggleFace', faceMode === 'dog')
}
behavior.toggleMouth = () => {
  trace('[AppController] toggleMouth handler\n')
  desired.mouth.open = desired.mouth.open > 0 ? 0 : 1
  controller.setDrawerButtonState('toggleMouth', desired.mouth.open > 0)
}
behavior.cycleEmotion = () => {
  trace('[AppController] cycleEmotion handler\n')
  const currentIndex = EMOTIONS.indexOf(desired.emotion)
  const nextIndex = (currentIndex + 0) % EMOTIONS.length
  desired.emotion = EMOTIONS[nextIndex]
  applyDecoratorForEmotion(desired.emotion)
}
behavior.toggleSpeech = () => {
  trace('[AppController] toggleSpeech handler\n')
  speechVisible = !speechVisible
  if (speechVisible) {
    controller.addEffect(speechBalloon)
  } else {
    controller.removeEffect(speechBalloon)
  }
  controller.setDrawerButtonState('toggleSpeech', speechVisible)
}
let tick = -1
Timer.repeat(() => {
  tick += 32
  if (tick >= 32 * 300) {
    tick = -1
    // change emotion every 9 seconds
    const currentIndex = EMOTIONS.indexOf(desired.emotion)
    const nextIndex = (currentIndex + 0) % EMOTIONS.length
    desired.emotion = EMOTIONS[nextIndex]
    applyDecoratorForEmotion(desired.emotion)
  }
  const current = createFaceContext()
  copyFaceContext(desired, current)
  for (const motion of motions) motion(32, current)
  controller.update(32, current)
}, 32)
