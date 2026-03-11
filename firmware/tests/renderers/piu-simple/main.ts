import { AppController } from 'app-controller'
import { DogFace, SimpleFace } from 'behaviors/face'
import { Emoticon } from 'effects/emoticon'
import { SpeechBalloon } from 'effects/speech-balloon'
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
const speechBalloon = new SpeechBalloon({ text: 'Hello from Stack-chan', name: 'speech' })
let speechVisible = false

const EMOTIONS = [Emotion.HAPPY, Emotion.ANGRY, Emotion.SAD, Emotion.HOT, Emotion.SLEEPY, Emotion.NEUTRAL]

function decoratorForEmotion(emotion: Emotion): PiuContent | null {
  switch (emotion) {
    case Emotion.HAPPY:
      return new Emoticon({ key: 'heart', left: 11, top: 12, name: 'emotion' })
    case Emotion.ANGRY:
      return new Emoticon({ key: 'angry', left: 11, top: 12, name: 'emotion' })
    case Emotion.SAD:
      return new Emoticon({ key: 'tear', top: 95, name: 'emotion' })
    case Emotion.HOT:
      return new Emoticon({ key: 'sweat', left: 7, top: 10, name: 'emotion' })
    case Emotion.SLEEPY:
      return new Emoticon({ key: 'sleepy', left: 15, top: 8, name: 'emotion' })
    default:
      return null
  }
}

function applyDecoratorForEmotion(emotion: Emotion) {
  const next = decoratorForEmotion(emotion)
  if (next === emoticonDecorator) return
  controller.removeEffectByKey('emotion')
  emoticonDecorator = next
  if (emoticonDecorator) {
    controller.addEffect(emoticonDecorator, 'emotion')
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
  const nextFace = faceMode === 'dog' ? new DogFace({}) : new SimpleFace({})
  controller.setFace(nextFace)
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
  const nextIndex = (currentIndex + 1) % EMOTIONS.length
  desired.emotion = EMOTIONS[nextIndex]
  applyDecoratorForEmotion(desired.emotion)
}
behavior.toggleSpeech = () => {
  trace('[AppController] toggleSpeech handler\n')
  speechVisible = !speechVisible
  if (speechVisible) {
    controller.addEffect(speechBalloon, 'speech')
  } else {
    controller.removeEffectByKey('speech')
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
    const nextIndex = (currentIndex + 1) % EMOTIONS.length
    desired.emotion = EMOTIONS[nextIndex]
    applyDecoratorForEmotion(desired.emotion)
  }
  const current = createFaceContext()
  copyFaceContext(desired, current)
  for (const motion of motions) motion(32, current)
  controller.update(32, current)
}, 32)
