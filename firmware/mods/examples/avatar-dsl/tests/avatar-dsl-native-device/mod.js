// SPDX-License-Identifier: Apache-2.0
// Instrumented diagnostic only. JS VM is an independent reference, never the animation backend.

import { createContext } from 'avatar-dsl/context'
import { createAvatarFace, loadPreset } from 'avatar-dsl/face'
import { allocationStats, NativeVM } from 'avatar-dsl/native'
import { AvatarVM } from 'avatar-dsl/vm'
import Debug from 'debug'
import { createFaceState } from 'face-state'
import Instrumentation from 'instrumentation'
import config from 'mc/config'
import { Container, Skin } from 'piu/MC'
import Time from 'time'
import Timer from 'timer'

const wait = (ms) => new Promise((resolve) => Timer.set(resolve, ms))
const ticks = () => Time.ticks >>> 0
const delta = (start) => (ticks() - start) >>> 0
const measure = (name) => Instrumentation.get(Instrumentation.map(name))
function check(value, label) {
  trace(`[AVDS-NATIVE] CHECK ${value ? 'PASS' : 'FAIL'} ${label}\n`)
  if (!value) throw new Error(label)
}
function heap(label) {
  Debug.gc()
  trace(
    `[AVDS-NATIVE] HEAP ${label} ticks=${ticks()} slots=${measure('XS Slot Heap Used')} chunks=${measure('XS Chunk Heap Used')} system=${measure('System Free Memory')} native=${JSON.stringify(allocationStats())}\n`,
  )
}
async function phase(face, state, preset, dynamic) {
  const start = ticks(),
    before = face.renderer.stats
  let writes = 0
  const input = dynamic
    ? Timer.repeat(() => {
        writes++
        state.emotion = writes % 6
        state.mouth.open = (writes % 30) / 30
        state.eyes.left.gazeX = state.eyes.right.gazeX = Math.sin(writes / 15)
        state.eyes.left.gazeY = state.eyes.right.gazeY = Math.cos(writes / 20)
        face.content.behavior.onFaceUpdate(face.content, state)
      }, 33)
    : null
  trace(`[AVDS-NATIVE] PHASE_BEGIN preset=${preset} dynamic=${dynamic} ticks=${start}\n`)
  let previous = start
  const samples = Timer.repeat(() => {
    const now = ticks()
    // Capture native counters with monotonic timestamps. SDK instrumentation
    // independently prints its counters; reading CPU/GC getters here could reset
    // their intervals. Preserve those instrument lines in the serial capture.
    trace(
      `[AVDS-NATIVE] SAMPLE ticks=${now} captureIntervalMs=${(now - previous) >>> 0} stats=${JSON.stringify(face.renderer.stats)}\n`,
    )
    previous = now
  }, 1000)
  try {
    await wait(12000)
  } finally {
    Timer.clear(samples)
    if (input !== null) Timer.clear(input)
  }
  const after = face.renderer.stats,
    differences = {}
  for (const name of [
    'evaluations',
    'updates',
    'ticks',
    'preparations',
    'rasterPasses',
    'vmUs',
    'geometryUs',
    'rasterSubmitUs',
    'rasterUs',
    'failures',
  ])
    differences[name] = after[name] - before[name]
  trace(
    `[AVDS-NATIVE] PHASE_END preset=${preset} dynamic=${dynamic} actualMs=${delta(start)} writes=${writes} delta=${JSON.stringify(differences)} nativeBytes=${after.nativeBytes}\n`,
  )
  check(!face.content.behavior.failure && differences.ticks > 0, `${preset}-native-animation`)
  check(differences.failures === 0, `${preset}-no-fallback`)
}
export function onLaunch() {
  return true
}
export async function onContextCreated(robot) {
  check(config.driver?.type === 'none' && config.driver?.typeLocked === true, 'diagnostic-host-driver-none-locked')
  trace('[AVDS-NATIVE] START native-loop rasterUs excludes transfer; SDK CPU covers all tasks\n')
  const state = createFaceState(),
    commands = new Int32Array(96 * 8),
    snapshot = createContext()
  let face = null
  heap('before-face')
  for (const preset of ['default', 'omega', 'aokko']) {
    let outgoing = face
    face = createAvatarFace({ preset, variables: { 27: 1, 34: 1 } })
    robot.ui.setFace(face.content)
    check(!!face.content.application, `${preset}-attached`)
    if (outgoing) {
      const before = outgoing.renderer.stats.elapsed
      await wait(100)
      check(outgoing.renderer.stats.elapsed === before && !outgoing.renderer.running, 'swap-stops-clock')
      outgoing.dispose()
      outgoing = null
    }
    robot.ui.setFaceMotionEnabled(false)
    for (let emotion = 0; emotion < 6; emotion++) {
      robot.face.setEmotion(emotion)
      robot.face.setEyeOpen('left', 1)
      robot.face.setEyeOpen('right', 1)
      robot.face.setMouthOpen(emotion % 2)
      // Host FaceState notifications are batched on its timer. Let that
      // observable update arrive before checking the native renderer snapshot.
      await wait(140)
      face.renderer.snapshot(snapshot, commands)
      check(
        snapshot[9] === [0, 3, 2, 1, 5, 4][emotion] && snapshot[8] === emotion % 2,
        `${preset}-host-expression-mouth-${emotion}`,
      )
    }
    const vm = new NativeVM(loadPreset(preset)),
      reference = new AvatarVM(loadPreset(preset)),
      ctx = createContext(),
      start = ticks()
    for (let i = 0; i < 100; i++) {
      ctx[8] = ctx[31] = (i % 20) / 20
      ctx[9] = i % 6
      const n = vm.run(ctx, commands)
      reference.run(ctx)
      let equal = n === reference.count
      for (let j = 0; j < n * 8; j++) equal &&= commands[j] === reference.commands[j]
      check(equal, `${preset}-oracle-commands-${i}`)
      if (i % 10 === 9) await wait(1)
    }
    trace(
      `[AVDS-NATIVE] VM_REFERENCE preset=${preset} frames=100 actualMs=${delta(start)} nativeVmUs=${vm.stats.vmUs}\n`,
    )
    vm.close()
    robot.ui.setFaceMotionEnabled(true)
    await phase(face, state, preset, false)
    await phase(face, state, preset, true)
    robot.ui.setFaceMotionEnabled(false)
    const stopped = face.renderer.stats.elapsed
    await wait(150)
    check(!face.renderer.running && face.renderer.stats.elapsed === stopped, 'motion-stop')
    robot.ui.setFaceMotionEnabled(true)
    robot.ui.setMain(
      new Container(null, { left: 0, top: 0, width: 320, height: 240, skin: new Skin({ fill: 'black' }) }),
    )
    const hidden = face.renderer.stats.elapsed
    await wait(150)
    check(!face.renderer.running && face.renderer.stats.elapsed === hidden, 'hidden-freezes-clock')
    robot.ui.showFace()
    await wait(150)
    check(face.renderer.running && face.renderer.stats.elapsed > hidden, 'show-resumes')
    heap(`${preset}-after-phases`)
  }
  const loop = new Uint8Array([65, 86, 68, 83, 1, 0, 0, 0, 0, 0, 1, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 48, 253, 255])
  for (const bytecode of [new ArrayBuffer(0), loop.buffer]) {
    const recovered = createAvatarFace({ width: 240, height: 240, circular: true, bytecode, variables: { 22: 999 } })
    recovered.renderer.snapshot(snapshot, commands)
    check(
      !!recovered.content.behavior.failure &&
        snapshot[22] === 50 &&
        snapshot[2] === createContext({ width: 240, height: 240, circular: true })[2],
      'safe-geometry-tuning',
    )
    robot.ui.setFace(recovered.content)
    face.dispose()
    face = recovered
    await wait(150)
  }
  const restored = createAvatarFace()
  robot.ui.setFace(restored.content)
  face.dispose()
  face = restored
  robot.face.setEmotion(0)
  robot.face.setMouthOpen(0)
  robot.face.setEyeOpen('left', 1)
  robot.face.setEyeOpen('right', 1)
  heap('completed-default')
  trace('[AVDS-NATIVE] COMPLETE default-restored\n')
}
