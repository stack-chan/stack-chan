import Timer from 'timer'
import { Application, type Content as PiuContent } from 'piu/MC'
import { AppController } from 'app-controller'
import { FaceTemplate, createDogFaceParams, createSimpleFaceParams } from 'behaviors/face'
import { createEmoticonEffect } from 'effects/emoticon'
import { createSpeechBalloonEffect } from 'effects/speech-balloon'
import { copyFaceContext, createFaceContext, defaultFaceContext, type FaceContext, Emotion } from 'face-context'
import { createBlinkMotion } from 'motions/blink'
import { createBreathMotion } from 'motions/breath'
import { createSaccadeMotion } from 'motions/saccade'

let faceMode: 'simple' | 'dog' = 'simple'
const application = new Application(
  {
    faceTemplate: FaceTemplate,
    faceParams: createSimpleFaceParams(),
    drawerButtons: [
      { key: 'setFace', label: 'Face', kind: 'toggle' },
      { key: 'toggleMouth', label: 'Mouth', kind: 'toggle' },
      { key: 'cycleEmotion', label: 'Emotion' },
      { key: 'toggleSpeech', label: 'Speech', kind: 'toggle' },
    ],
    drawerTopOffset: 0,
  },
  { displayListLength: 2048, contents: [], Behavior: AppController },
)
const controller = application.behavior as AppController
controller.application.distribute?.('onFaceMode', faceMode)

const desired: FaceContext = createFaceContext()
copyFaceContext(defaultFaceContext, desired)
desired.theme.primary = '#ffffff'
desired.theme.secondary = '#222222'

const motions = [
  createBlinkMotion({ openMin: 400, openMax: 5000, closeMin: 200, closeMax: 400 }),
  // createBreathMotion({ duration: 6000 }),
  // createSaccadeMotion({ updateMin: 300, updateMax: 2000, gain: 0.2 }),
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
    controller.removeEffect(emoticonDecorator)
  }
  emoticonDecorator = next
  if (emoticonDecorator) {
    controller.addEffect(emoticonDecorator)
  }
}

applyDecoratorForEmotion(desired.emotion)

// Action handlers invoked via application.delegate(action)
const behavior = controller as unknown as {
  setFace?: () => void
  toggleMouth?: () => void
  cycleEmotion?: () => void
  toggleSpeech?: () => void
}
behavior.setFace = () => {
  faceMode = faceMode === 'dog' ? 'simple' : 'dog'
  const params = faceMode === 'dog' ? createDogFaceParams() : createSimpleFaceParams()
  controller.setFaceTemplate(FaceTemplate, params)
  controller.application.distribute?.('onFaceMode', faceMode)
}
behavior.toggleMouth = () => {
  desired.mouth.open = desired.mouth.open > 0 ? 0 : 1
}
behavior.cycleEmotion = () => {
  const currentIndex = EMOTIONS.indexOf(desired.emotion)
  const nextIndex = (currentIndex + 1) % EMOTIONS.length
  desired.emotion = EMOTIONS[nextIndex]
  applyDecoratorForEmotion(desired.emotion)
}
behavior.toggleSpeech = () => {
  speechVisible = !speechVisible
  if (speechVisible) {
    controller.addEffect(speechBalloon)
  } else {
    controller.removeEffect(speechBalloon)
  }
}
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
  controller.update(33, current)
}, 33)
