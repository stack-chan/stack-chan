// SPDX-License-Identifier: Apache-2.0
import { microseconds, RasterProbe } from 'avatar-dsl/comparison-probe'
import { createContext } from 'avatar-dsl/context'
import { createAvatarFace as createNative, loadPreset } from 'avatar-dsl/face'
import { createAvatarFace as createLegacy } from 'avatar-dsl/legacy-face'
import { NativeVM } from 'avatar-dsl/native'
import { AvatarVM } from 'avatar-dsl/vm'
import Debug from 'debug'
import { createFaceState } from 'face-state'
import config from 'mc/config'
import Time from 'time'
import Timer from 'timer'

const wait = (ms) => new Promise((resolve) => Timer.set(resolve, ms))
const now = () => Time.ticks >>> 0
const usDelta = (start) => (microseconds() - start) >>> 0
function check(value, label) {
  trace(`[AVDS-COMPARE] CHECK ${value ? 'PASS' : 'FAIL'} ${label}\n`)
  if (!value) throw new Error(label)
}
function log(kind, value) {
  trace(`[AVDS-COMPARE] ${kind} ${JSON.stringify(value)}\n`)
}
function observeLegacy(face) {
  const counters = { evaluations: 0, preparations: 0, calls: 0, vmUs: 0, geometryUs: 0, preparationUs: 0 }
  const behavior = face.content.behavior
  const originalVM = behavior.vm.run
  behavior.vm.run = function (context) {
    const start = microseconds()
    const result = originalVM.call(this, context)
    counters.vmUs += usDelta(start)
    counters.evaluations++
    return result
  }
  const originalPresent = behavior.present
  behavior.present = function (vm) {
    const start = microseconds()
    originalPresent.call(this, vm)
    counters.geometryUs += usDelta(start)
  }
  const originalRender = behavior.render
  behavior.render = function () {
    const before = counters.evaluations,
      start = microseconds()
    originalRender.call(this)
    counters.calls++
    if (counters.evaluations > before) {
      counters.preparations++
      counters.preparationUs += usDelta(start)
    }
  }
  return () => ({ ...counters })
}
function wrap(face) {
  const target = face.content.behavior
  class Relay extends Behavior {
    constructor() {
      super()
      this.breathPixels = 0
      this.preservePositionOnSwap = false
    }
    onFaceUpdate(_content, state) {
      target.onFaceUpdate(face.content, state)
    }
    rehydrate(_content, state) {
      target.rehydrate(face.content, state)
    }
    setMotionsEnabled(_content, enabled) {
      target.setMotionsEnabled(face.content, enabled)
    }
    onTouchEnded(content) {
      content.bubble('onFaceTouch')
    }
  }
  return new RasterProbe(null, {
    left: 0,
    top: 0,
    width: 320,
    height: 240,
    clip: true,
    behavior: new Relay(),
    contents: [face.content],
  })
}
function difference(after, before) {
  const result = {}
  for (const name of Object.keys(after))
    if (typeof after[name] === 'number') result[name] = after[name] - (before[name] ?? 0)
  return result
}
async function benchVM(preset) {
  const context = createContext(),
    commands = new Int32Array(96 * 8),
    old = new AvatarVM(loadPreset(preset)),
    current = new NativeVM(loadPreset(preset))
  let jsUs = 0,
    nativeCallUs = 0
  for (let i = 0; i < 30; i++) {
    context[8] = context[31] = (i % 20) / 20
    context[9] = i % 6
    let start = microseconds()
    old.run(context)
    jsUs += usDelta(start)
    start = microseconds()
    const count = current.run(context, commands)
    nativeCallUs += usDelta(start)
    let equal = count === old.count
    for (let j = 0; j < count * 8; j++) equal &&= commands[j] === old.commands[j]
    check(equal, `${preset}-same-vm-context-${i}`)
    await wait(1)
  }
  log('VM_BENCH', { preset, frames: 30, jsUs, nativeCallUs, nativeUs: current.stats.vmUs })
  current.close()
}
async function phase(robot, backend, preset, dynamic, repeat) {
  const face = (backend === 'js' ? createLegacy : createNative)({ preset, variables: { 27: 1, 34: 1 } }),
    probe = wrap(face),
    read = backend === 'js' ? observeLegacy(face) : () => face.renderer.stats,
    input = createFaceState()
  robot.face.setEmotion(0)
  robot.face.setMouthOpen(0)
  robot.face.setEyeOpen('left', 1)
  robot.face.setEyeOpen('right', 1)
  robot.ui.setFace(probe)
  robot.ui.setFaceMotionEnabled(true)
  check(!!face.content.application, `${backend}-${preset}-attached`)
  const beginning = now()
  // Both backends receive the same function of real elapsed time. Slower
  // callbacks skip input deadlines instead of stretching the input sequence.
  let writes = 0
  const timer = dynamic
    ? Timer.repeat(() => {
        const tick = Math.floor(((now() - beginning) >>> 0) / 33)
        input.emotion = tick % 6
        input.mouth.open = (tick % 30) / 30
        input.eyes.left.gazeX = input.eyes.right.gazeX = Math.sin(tick / 15)
        input.eyes.left.gazeY = input.eyes.right.gazeY = Math.cos(tick / 20)
        face.content.behavior.onFaceUpdate(face.content, input)
        writes++
      }, 33)
    : null
  await wait(3000)
  const start = now(),
    before = read(),
    drawBefore = probe.stats,
    writesBefore = writes,
    identity = { backend, preset, dynamic, repeat }
  log('PHASE_BEGIN', { ...identity, ticks: start, counters: before, draw: drawBefore })
  let previous = start
  const sampler = Timer.repeat(() => {
    const ticks = now()
    log('SAMPLE', { ...identity, ticks, intervalMs: (ticks - previous) >>> 0, counters: read(), draw: probe.stats })
    previous = ticks
  }, 1000)
  await wait(15000)
  Timer.clear(sampler)
  const end = now(),
    after = read(),
    drawAfter = probe.stats
  log('PHASE_END', {
    ...identity,
    ticks: end,
    actualMs: (end - start) >>> 0,
    writes: writes - writesBefore,
    delta: difference(after, before),
    drawDelta: difference(drawAfter, drawBefore),
  })
  if (timer !== null) Timer.clear(timer)
  check(!face.content.behavior.failure, `${backend}-${preset}-no-fallback`)
  check(drawAfter.pairs > drawBefore.pairs && drawAfter.unmatched === 0, `${backend}-${preset}-raster-pairs`)
  robot.ui.setFaceMotionEnabled(false)
  face.dispose()
  robot.ui.setFace(new RasterProbe(null, { left: 0, top: 0, width: 320, height: 240 }))
  await wait(150)
  Debug.gc()
}
export function onLaunch() {
  return true
}
export async function onContextCreated(robot) {
  check(config.driver?.type === 'none' && config.driver.typeLocked === true, 'driver-none-locked')
  log('START', { durationMs: 15000, warmupMs: 3000, repeats: 2, inputMs: 33, sdk: '9.5.0', sharedHost: true })
  for (const preset of ['default', 'omega', 'aokko']) await benchVM(preset)
  for (let repeat = 0; repeat < 2; repeat++)
    for (const preset of ['default', 'omega', 'aokko'])
      for (const dynamic of [false, true])
        for (const backend of repeat === 0 ? ['js', 'native'] : ['native', 'js'])
          await phase(robot, backend, preset, dynamic, repeat)
  const restored = createNative()
  robot.ui.setFace(restored.content)
  robot.face.setEmotion(0)
  robot.face.setMouthOpen(0)
  robot.ui.setFaceMotionEnabled(true)
  trace('[AVDS-COMPARE] COMPLETE default-restored\n')
}
