// SPDX-License-Identifier: Apache-2.0
import { displayStats, microseconds, RasterProbe } from 'avatar-dsl/comparison-probe'
import { createAvatarFace } from 'avatar-dsl/face'
import Debug from 'debug'
import { createFaceState } from 'face-state'
import config from 'mc/config'
import Time from 'time'
import Timer from 'timer'

const wait = (ms) => new Promise((resolve) => Timer.set(resolve, ms))
const now = () => Time.ticks >>> 0
const duration = (start) => (microseconds() - start) >>> 0
function check(value, label) {
  trace(`[AVDS-PROFILE] CHECK ${value ? 'PASS' : 'FAIL'} ${label}\n`)
  if (!value) throw new Error(label)
}
function log(kind, value) {
  trace(`[AVDS-PROFILE] ${kind} ${JSON.stringify(value)}\n`)
}
function delta(after, before) {
  const result = {}
  for (const key of Object.keys(after))
    if (typeof after[key] === 'number') result[key] = after[key] - (before[key] ?? 0)
  return result
}
function wrap(face) {
  class Relay extends Behavior {
    constructor() {
      super()
      this.breathPixels = 0
      this.preservePositionOnSwap = false
    }
    onFaceUpdate(_content, state) {
      face.content.behavior.onFaceUpdate(face.content, state)
    }
    rehydrate(_content, state) {
      face.content.behavior.rehydrate(face.content, state)
    }
    setMotionsEnabled(_content, enabled) {
      face.content.behavior.setMotionsEnabled(face.content, enabled)
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
async function phase(robot, preset, dynamic, repeat) {
  const face = createAvatarFace({ preset, variables: { 27: 1, 34: 1 } }),
    probe = wrap(face),
    input = createFaceState(),
    counters = { inputUs: 0, stateUs: 0, writes: 0 }
  const behavior = face.content.behavior,
    original = behavior.onFaceUpdate
  behavior.onFaceUpdate = function (content, state) {
    const start = microseconds()
    original.call(this, content, state)
    counters.stateUs += duration(start)
    counters.writes++
  }
  robot.face.setEmotion(0)
  robot.face.setMouthOpen(0)
  robot.face.setEyeOpen('left', 1)
  robot.face.setEyeOpen('right', 1)
  robot.ui.setFace(probe)
  robot.ui.setFaceMotionEnabled(true)
  check(!!face.content.application, `${preset}-attached`)
  const beginning = now()
  const timer = dynamic
    ? Timer.repeat(() => {
        const start = microseconds(),
          tick = Math.floor(((now() - beginning) >>> 0) / 33)
        input.emotion = tick % 6
        input.mouth.open = (tick % 30) / 30
        input.eyes.left.gazeX = input.eyes.right.gazeX = Math.sin(tick / 15)
        input.eyes.left.gazeY = input.eyes.right.gazeY = Math.cos(tick / 20)
        counters.inputUs += duration(start)
        behavior.onFaceUpdate(face.content, input)
      }, 33)
    : null
  await wait(3000)
  const start = now(),
    before = face.renderer.stats,
    drawBefore = probe.stats,
    displayBefore = displayStats(),
    stateBefore = { ...counters },
    identity = { preset, dynamic, repeat }
  log('PHASE_BEGIN', { ...identity, ticks: start })
  const sampler = Timer.repeat(() => {
    log('SAMPLE', {
      ...identity,
      ticks: now(),
      native: face.renderer.stats,
      raster: probe.stats,
      display: displayStats(),
      state: counters,
    })
  }, 1000)
  await wait(15000)
  Timer.clear(sampler)
  const end = now()
  log('PHASE_END', {
    ...identity,
    actualMs: (end - start) >>> 0,
    native: delta(face.renderer.stats, before),
    raster: delta(probe.stats, drawBefore),
    display: delta(displayStats(), displayBefore),
    state: delta(counters, stateBefore),
  })
  if (timer !== null) Timer.clear(timer)
  check(!behavior.failure, `${preset}-no-fallback`)
  check(probe.stats.pairs > drawBefore.pairs && probe.stats.unmatched === 0, `${preset}-raster-pairs`)
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
  log('START', { durationMs: 15000, warmupMs: 3000, repeats: 2, inputMs: 33 })
  for (let repeat = 0; repeat < 2; repeat++)
    for (const preset of repeat === 0 ? ['default', 'omega', 'aokko'] : ['aokko', 'omega', 'default'])
      for (const dynamic of [false, true]) await phase(robot, preset, dynamic, repeat)
  const face = createAvatarFace()
  robot.ui.setFace(face.content)
  robot.ui.setFaceMotionEnabled(true)
  trace('[AVDS-PROFILE] COMPLETE default-restored\n')
}
