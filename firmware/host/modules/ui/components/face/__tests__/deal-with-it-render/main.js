import { createFaceSkinPalette } from 'face-skin'
import { createFaceState, Emotion } from 'face-state'
import { FaceMainTemplate } from 'face-view'
import { DealWithItFace } from 'parts/image/deal-with-it-face'
import 'piu/MC'

function check(value, message) {
  if (!value) throw new Error(message)
}

const face = new DealWithItFace({ motions: [] })
const behavior = face.behavior
const state = createFaceState()
state.breath = 0
behavior.setMotionsEnabled(face, false)
const glasses = face.first.next
const mouth = glasses.next
const textureSkin = glasses.skin
check(face.length === 3 && !mouth.next, 'head, ONE glasses image, mouth')
check(!glasses.behavior, 'static glasses must not react to blink or gaze')

// Use the production Die region, including its padding for breathing.
const main = new FaceMainTemplate({ face })
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
      if (step === 12) {
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
          face.distribute('onFaceSkin', createFaceSkinPalette(0, 0xffffff))
        }
        if (scenario === 4) {
          main.skin = new Skin({ fill: 'black' })
          behavior.setMotionsEnabled(face, true)
          face.stop()
        }
        if (scenario === 5) state.breath = 1
        behavior.onFaceUpdate(face, state)
        if (scenario >= 4) behavior.onTimeChanged(face)
        check(glasses.skin === textureSkin, 'theme and animation must preserve the glasses skin')
        check(mouth.variant === (scenario >= 2 ? 3 : 0), 'mouth must follow speech independently')
      }
      // Force a full redraw after each partial update to detect clipping/stale pixels.
      if (step & 1) invalidator.invalidate(0, 0, 320, 240)
      else invalidator.invalidate(0, 0, 1, 1)
      step++
    }
  },
})
