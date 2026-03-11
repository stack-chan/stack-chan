import Timer from 'timer'
import { Renderer, type FaceDecorator } from 'renderer-simple'
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

const EMOTIONS = [Emotion.HAPPY, Emotion.ANGRY, Emotion.SAD]
let tick = 0
Timer.repeat(() => {
  tick += 33
  if (tick >= 33 * 300) {
    tick = 0
    // change emotion every 10 seconds
    const currentIndex = EMOTIONS.indexOf(desired.emotion)
    const nextIndex = (currentIndex + 1) % EMOTIONS.length
    desired.emotion = EMOTIONS[nextIndex]
  }
  const current = createFaceContext()
  copyFaceContext(desired, current)
  for (const mod of modifiers) mod(33, current)
  renderer.update(33, current)
}, 33)
