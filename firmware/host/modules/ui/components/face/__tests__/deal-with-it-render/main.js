import { SimpleFace } from 'behaviors/face'
import { createFaceSkinPalette } from 'face-skin'
import { createFaceState, Emotion } from 'face-state'
import { FaceMainTemplate } from 'face-view'
import { DealWithItFace } from 'parts/image/deal-with-it-face'
import 'piu/MC'

function check(value, message) {
  if (!value) {
    trace(`FAIL: ${message}\n`)
    throw new Error(message)
  }
}

const face = new DealWithItFace({ motions: [] })
const behavior = face.behavior
const state = createFaceState()
state.breath = 0
behavior.setMotionsEnabled(face, false)
const glasses = face.first
const mouth = glasses.next
const textureSkin = glasses.skin
check(face.length === 2 && !mouth.next, 'ONE glasses image and the simple face mouth; no head')
check(!glasses.behavior, 'static glasses must not react to blink or gaze')

// Use the production Die region, including its padding for breathing.
const main = new FaceMainTemplate({ face })
const simple = new SimpleFace({ motions: [] })
simple.behavior.setMotionsEnabled(simple, false)
const simpleMain = new FaceMainTemplate({ face: simple })
const invalidator = new Port(null, { left: 0, top: 0, width: 320, height: 240 })
let step = 0
export default new Application(null, {
  displayListLength: 4096,
  skin: new Skin({ fill: 'black' }),
  contents: [main, invalidator],
  Behavior: class extends Behavior {
    onDisplaying(app) {
      app.interval = 60
      app.start()
    }
    onTimeChanged(app) {
      if (step === 16) {
        app.stop()
        face.stop()
        trace('DEAL WITH IT PASS; RENDER COMPLETE\n')
        return
      }
      const scenario = step >> 1
      if (!(step & 1)) {
        if (scenario === 1) {
          state.emotion = Emotion.ANGRY
          state.eyes.left.open = state.eyes.right.open = 0
          state.eyes.left.gazeX = -1
          state.eyes.right.gazeY = 1
        }
        if (scenario === 2) state.mouth.open = 1
        if (scenario === 3) {
          main.skin = new Skin({ fill: 'white' })
          state.theme.primary.r = state.theme.primary.g = state.theme.primary.b = 0
          state.theme.secondary.r = state.theme.secondary.g = state.theme.secondary.b = 255
          face.distribute('onFaceSkin', createFaceSkinPalette(0, 0xffffff))
        }
        if (scenario === 4) {
          main.skin = new Skin({ fill: 'black' })
          state.theme.primary.r = state.theme.primary.g = state.theme.primary.b = 255
          state.theme.secondary.r = state.theme.secondary.g = state.theme.secondary.b = 0
          face.distribute('onFaceSkin', createFaceSkinPalette(0xffffff, 0))
          behavior.setMotionsEnabled(face, true)
          face.stop()
        }
        if (scenario === 5) state.breath = 1
        if (scenario === 6) {
          state.mouth.open = 0
          state.breath = 0
          app.replace(main, simpleMain)
        }
        if (scenario === 7) state.mouth.open = 1
        if (scenario < 6) {
          behavior.onFaceUpdate(face, state)
          if (scenario >= 4) behavior.onTimeChanged(face)
        } else simple.behavior.onFaceUpdate(simple, state)
        check(glasses.skin === textureSkin, 'theme and animation must preserve the glasses skin')
      }
      // Force a full redraw after each partial update to detect clipping/stale pixels.
      if (step & 1) invalidator.invalidate(0, 0, 320, 240)
      else invalidator.invalidate(0, 0, 1, 1)
      step++
    }
  },
})
