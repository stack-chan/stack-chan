import { createFaceState } from 'face-state'
import { createJitomeFace } from 'jitome-face'
import 'piu/MC'

function check(value, message) {
  if (!value) throw new Error(message)
}
const face = createJitomeFace(),
  b = face.content.behavior,
  state = createFaceState()
b.setMotionsEnabled(face.content, false)
const iris = b.geometry.points[0].slice(),
  outlines = b.outlines.slice(),
  bases = b.bases.slice(),
  buffers = b.geometry.points.slice()
check(b.bases[0].clone(b.outlines[0]) === b.outlines[0], 'Outline.clone(destination) must reuse its destination')
state.eyes.left.open = state.eyes.right.open = 0
b.onFaceUpdate(face.content, state)
for (let i = 0; i < iris.length; i++) check(iris[i] === b.geometry.points[0][i], 'blink moved iris')
check(b.geometry.points[1][5] > b.geometry.points[0][7], 'closed lid must cover iris')
check(b.geometry.points[3][1] === 98.625, 'brow must descend three device pixels')
for (let i = 0; i < 10; i++) check(outlines[i] === b.outlines[i], 'outline allocation identity')
for (let i = 0; i < 9; i++)
  check(bases[i] === b.bases[i] && buffers[i] === b.geometry.points[i], 'geometry allocation identity')
state.eyes.left.open = state.eyes.right.open = 1
b.onFaceUpdate(face.content, state)
check(b.geometry.update(1, 1, 0, 0, 0, 0, 0) === 0, 'unchanged face must skip updates')
trace('GEOMETRY PASS\n')
let step = 0
export default new Application(null, {
  skin: new Skin({ fill: 'black' }),
  contents: [face.content],
  Behavior: class extends Behavior {
    onDisplaying(app) {
      app.interval = 35
      app.start()
    }
    onTimeChanged(app) {
      if (step === 32) {
        app.stop()
        trace('RENDER COMPLETE\n')
        return
      }
      const i = step >> 1
      if (!(step & 1)) {
        state.eyes.left.open = [1, 0.75, 0.5, 0.25, 0, 0.25, 0.75, 1][i % 8]
        state.eyes.right.open = i < 8 ? state.eyes.left.open : 1 - state.eyes.left.open
        state.eyes.left.gazeX = i < 8 ? 0 : i & 1 ? -1 : 1
        state.eyes.right.gazeY = i < 8 ? 0 : i & 1 ? 1 : -1
        state.mouth.open = i < 8 ? 0 : (i % 4) / 3
        if (i === 12) {
          state.theme.primary.r = state.theme.primary.g = state.theme.primary.b = 0
          state.theme.secondary.r = state.theme.secondary.g = state.theme.secondary.b = 255
        }
        b.onFaceUpdate(face.content, state)
        b.invalidator.invalidate(0, 0, 1, 1)
      } else b.invalidator.invalidate(0, 0, 320, 240)
      step++
    }
  },
})
