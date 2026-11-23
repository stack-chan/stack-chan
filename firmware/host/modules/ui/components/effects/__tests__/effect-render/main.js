import { SimpleFace } from 'behaviors/face'
import { Emoticon } from 'effects/emoticon'
import { createFaceState, Emotion } from 'face-state'
import { FaceView } from 'face-view'
import { Application, Port } from 'piu/MC'

const cases = [
  { emotion: Emotion.HOT, key: 'sweat', left: 58, top: 57, width: 64, height: 43 },
  { emotion: Emotion.SAD, key: 'tear', left: 60, top: 94, width: 200, height: 44 },
  { emotion: Emotion.DOUBTFUL, key: 'thinking' },
]
const framesPerCase = 29
const face = new SimpleFace({ motions: [] })
const view = new FaceView({ face })
const state = createFaceState()
const redraw = new Port(null, { left: 0, right: 0, top: 0, bottom: 0 })
let step = 0
let effect

export default new Application(null, {
  contents: [redraw, view],
  displayListLength: 2047,
  Behavior: class extends Behavior {
    onDisplaying(app) {
      face.stop()
      app.interval = 10
      app.start()
    }

    onTimeChanged(app) {
      const frame = step >> 1
      const test = cases[Math.floor(frame / framesPerCase)]
      if (!test) {
        app.stop()
        trace('EFFECT RENDER COMPLETE\n')
        return
      }
      if (step & 1) {
        redraw.invalidate()
      } else {
        const localFrame = frame % framesPerCase
        if (localFrame === 0) {
          effect = new Emoticon(test)
          view.behavior.addEffect(effect)
        }
        const faceFrame = Math.min(localFrame, framesPerCase - 2)
        state.emotion = test.emotion
        state.eyes.left.gazeX = state.eyes.right.gazeX = (faceFrame % 6) / 5 - 0.5
        state.breath = faceFrame % 2 ? 0.25 : 0
        view.behavior.onFaceUpdate(view, state)
        face.behavior.onTimeChanged(face)

        const port = effect.first
        port.stop()
        if (localFrame === framesPerCase - 1) {
          view.behavior.removeEffect(effect)
          redraw.invalidate(0, 0, 1, 1)
        } else {
          port.behavior.onTimeChanged(port)
          port.behavior.onTimeChanged(port)
        }
      }
      step++
    }
  },
})
