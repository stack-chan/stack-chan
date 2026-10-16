import { createContext } from 'avatar-dsl/context'
import { createAvatarFace, loadPreset } from 'avatar-dsl/face'
import { AvatarVM } from 'avatar-dsl/vm'
import Debug from 'debug'
import { createFaceState } from 'face-state'
import Instrumentation from 'instrumentation'
import { Container, Skin } from 'piu/MC'
import { showStartupSplash } from 'startup-splash'
import Timer from 'timer'

const wait = (ms) => new Promise((resolve) => Timer.set(resolve, ms))
const check = (value, label) => {
  trace(`[AVDS-DEVICE] CHECK ${value ? 'PASS' : 'FAIL'} ${label}\n`)
  if (!value) throw new Error(label)
}
const measure = (name) => Instrumentation.get(Instrumentation.map(name))
function heap(label) {
  Debug.gc()
  trace(
    `[AVDS-DEVICE] HEAP ${label} slots=${measure('XS Slot Heap Used')} chunks=${measure('XS Chunk Heap Used')} system=${measure('System Free Memory')}\n`,
  )
}
export function onLaunch() {
  showStartupSplash()
  return true
}
export async function onContextCreated(robot) {
  trace('[AVDS-DEVICE] START host-integration servo-driver-none\n')
  const state = createFaceState()
  let face = null
  heap('host-before-face')
  for (const preset of ['default', 'omega', 'aokko']) {
    const outgoing = face
    face = createAvatarFace({ preset, variables: { 27: 1, 34: 1 } })
    robot.ui.setFace(face.content)
    const behavior = face.content.behavior
    check(!behavior.failure && !!face.content.application, `${preset}-attached`)
    if (outgoing) {
      check(!outgoing.content.application, 'swap-detaches-outgoing')
      const frozen = outgoing.content.behavior.driver.elapsed
      await wait(150)
      check(outgoing.content.behavior.driver.elapsed === frozen, 'swap-freezes-clock')
      outgoing.dispose()
      check(!outgoing.content.running && !outgoing.content.visible, 'dispose-stops-hides')
    }
    robot.ui.setFaceMotionEnabled(false)
    for (let emotion = 0; emotion < 6; emotion++) {
      trace(`[AVDS-DEVICE] VISUAL preset=${preset} hostEmotion=${emotion}\n`)
      robot.face.setEmotion(emotion)
      robot.face.setEyeOpen('left', 1)
      robot.face.setEyeOpen('right', 1)
      robot.face.setMouthOpen(emotion % 2)
      await wait(140)
      check(behavior.context[9] === [0, 3, 2, 1, 5, 4][emotion], 'host-emotion-mapping')
      check(behavior.context[8] === emotion % 2, 'host-mouth-mapping')
      await wait(1700)
    }
    state.emotion = 0
    state.mouth.open = 0.5
    state.eyes.left.open = 0
    state.eyes.right.open = 1
    behavior.onFaceUpdate(face.content, state)
    check(behavior.context[5] === 0, 'independent-eye-minimum')
    await wait(1200)
    state.eyes.left.open = state.eyes.right.open = 1
    state.eyes.left.gazeX = state.eyes.right.gazeX = -1
    state.eyes.left.gazeY = state.eyes.right.gazeY = 1
    behavior.onFaceUpdate(face.content, state)
    check(behavior.context[6] === -1 && behavior.context[7] === 1, 'controlled-shared-gaze')
    await wait(1200)
    const vm = new AvatarVM(loadPreset(preset)),
      ctx = createContext()
    let vmMs = 0
    for (let i = 0; i < 100; i++) {
      ctx[8] = ctx[31] = (i % 20) / 20
      ctx[9] = i % 6
      const start = Date.now()
      vm.run(ctx)
      vmMs += Date.now() - start
      if (i % 10 === 9) await wait(1)
    }
    trace(`[AVDS-DEVICE] VM preset=${preset} frames=100 ms=${vmMs}\n`)
    let renderCount = 0,
      renderMs = 0,
      renderMax = 0
    const originalRender = behavior.render
    behavior.render = function () {
      const start = Date.now()
      originalRender.call(this)
      const elapsed = Date.now() - start
      renderCount++
      renderMs += elapsed
      renderMax = Math.max(renderMax, elapsed)
    }
    robot.ui.setFaceMotionEnabled(true)
    const dynamicStart = Date.now()
    let ticks = 0
    trace(`[AVDS-DEVICE] DYNAMIC preset=${preset} begin\n`)
    const timer = Timer.repeat(() => {
      ticks++
      state.mouth.open = (ticks % 30) / 30
      state.eyes.left.gazeX = state.eyes.right.gazeX = Math.sin(ticks / 15)
      state.eyes.left.gazeY = state.eyes.right.gazeY = Math.cos(ticks / 20)
      behavior.onFaceUpdate(face.content, state)
    }, 33)
    await wait(12000)
    Timer.clear(timer)
    trace(
      `[AVDS-DEVICE] RENDER preset=${preset} elapsed=${Date.now() - dynamicStart} ticks=${ticks} preparations=${renderCount} ms=${renderMs} maxMs=${renderMax}\n`,
    )
    behavior.render = originalRender
    check(!behavior.failure && behavior.context[3] > 0, 'dynamic-clock-no-fallback')
    heap(`${preset}-after-dynamic`)
    const before = behavior.driver.elapsed
    robot.ui.setFaceMotionEnabled(false)
    await wait(200)
    check(behavior.driver.elapsed === before && !face.content.running, 'motion-stop-freezes-clock')
    robot.ui.setFaceMotionEnabled(true)
    await wait(100)
    robot.ui.setMain(
      new Container(null, { left: 0, top: 0, width: 320, height: 240, skin: new Skin({ fill: 'black' }) }),
    )
    const hidden = behavior.driver.elapsed
    await wait(200)
    check(behavior.driver.elapsed === hidden && !face.content.application, 'hidden-main-freezes-clock')
    robot.ui.showFace()
    await wait(150)
    check(!!face.content.application && behavior.driver.elapsed > hidden, 'show-face-resumes')
  }
  const old = face
  face = createAvatarFace({
    width: 240,
    height: 240,
    circular: true,
    bytecode: new ArrayBuffer(0),
    variables: { 22: 999 },
  })
  robot.ui.setFace(face.content)
  old.dispose()
  check(
    !!face.content.behavior.failure &&
      face.content.behavior.context[2] === createContext({ width: 240, height: 240, circular: true })[2],
    'circular-decode-fallback',
  )
  await wait(1500)
  const loop = new Uint8Array([65, 86, 68, 83, 1, 0, 0, 0, 0, 0, 1, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 48, 253, 255])
  const recovered = createAvatarFace({
    width: 240,
    height: 240,
    circular: true,
    bytecode: loop.buffer,
    variables: { 22: 999 },
  })
  robot.ui.setFace(recovered.content)
  face.dispose()
  check(
    recovered.content.behavior.failure.includes('instruction budget') &&
      recovered.content.behavior.context[2] === createContext({ width: 240, height: 240, circular: true })[2],
    'circular-runtime-fallback',
  )
  await wait(1500)
  face = createAvatarFace({ preset: 'default' })
  robot.ui.setFace(face.content)
  recovered.dispose()
  robot.face.setEmotion(0)
  robot.face.setEyeOpen('left', 1)
  robot.face.setEyeOpen('right', 1)
  robot.face.setMouthOpen(0)
  heap('completed-default')
  trace('[AVDS-DEVICE] COMPLETE default-restored\n')
}
