import { createFaceState } from 'face-state'
import { createJitomeFace } from 'jitome-face'
import { Application, Skin } from 'piu/MC'
import Time from 'time'

const PHASE_DURATION = 18000
const phases = ['static', 'unchanged-30fps', 'blink-30fps', 'full-motion-30fps']
const state = createFaceState()
const face = createJitomeFace()
const behavior = face.content.behavior
behavior.enabled = false

let phase = 0
let phaseStarted = 0
let ticks = 0
let updates = 0
let step = 0

function beginPhase() {
  phaseStarted = Time.ticks
  ticks = 0
  updates = 0
  step = 0
  state.eyes.left.open = state.eyes.right.open = 1
  state.eyes.left.gazeX = state.eyes.left.gazeY = 0
  state.eyes.right.gazeX = state.eyes.right.gazeY = 0
  state.mouth.open = 0
  behavior.onFaceUpdate(face.content, state)
  trace(`[JITOME-BENCH] phase=${phases[phase]}\n`)
}

function updateFace() {
  if (phase === 0) return
  if (phase === 2) {
    const t = step % 60
    state.eyes.left.open = state.eyes.right.open = t < 30 ? 1 - t / 29 : (t - 30) / 29
  } else if (phase === 3) {
    const t = step % 60
    state.eyes.left.open = t < 30 ? 1 - t / 29 : (t - 30) / 29
    state.eyes.right.open = 1 - state.eyes.left.open
    state.eyes.left.gazeX = ((step % 41) - 20) / 20
    state.eyes.left.gazeY = ((step % 37) - 18) / 18
    state.eyes.right.gazeX = ((step % 43) - 21) / 21
    state.eyes.right.gazeY = ((step % 47) - 23) / 23
    state.mouth.open = (step % 31) / 30
  }
  behavior.onFaceUpdate(face.content, state)
  updates++
  step++
}

export default new Application(null, {
  pixels: 320 * 48,
  skin: new Skin({ fill: 'black' }),
  contents: [face.content],
  Behavior: class extends Behavior {
    onDisplaying(application) {
      application.interval = 33
      beginPhase()
      application.start()
    }
    onTimeChanged(application) {
      ticks++
      updateFace()
      const elapsed = Time.ticks - phaseStarted
      if (elapsed < PHASE_DURATION) return
      trace(`[JITOME-BENCH] result phase=${phases[phase]} elapsed=${elapsed} ticks=${ticks} updates=${updates}\n`)
      phase++
      if (phase === phases.length) {
        application.stop()
        trace('[JITOME-BENCH] complete\n')
      } else beginPhase()
    }
  },
})
