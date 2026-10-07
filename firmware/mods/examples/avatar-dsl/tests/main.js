// SPDX-License-Identifier: Apache-2.0

import { createContext } from 'avatar-dsl/context'
import { createAvatarFace, loadPreset } from 'avatar-dsl/face'
import { AvatarVM } from 'avatar-dsl/vm'
import Debug from 'debug'
import { createFaceState } from 'face-state'
import Instrumentation from 'instrumentation'
import { Application, Container, Skin } from 'piu/MC'
import Timer from 'timer'

const check = (value, message) => {
  if (!value) {
    trace(`CHECK FAILED ${message}\n`)
    throw new Error(message)
  }
}
const presets = ['default', 'omega', 'aokko']
const faces = presets.map((preset) => createAvatarFace({ preset, variables: { 27: 1, 32: 1 } }))
const state = createFaceState()
function heap(label) {
  Debug.gc()
  trace(
    `HEAP ${label} slots=${Instrumentation.get(Instrumentation.map('XS Slot Heap Used'))} chunks=${Instrumentation.get(Instrumentation.map('XS Chunk Heap Used'))} gc=${Instrumentation.get(Instrumentation.map('XS Garbage Collection Count'))}\n`,
  )
}
heap('three-faces')
for (const f of faces) f.content.behavior.setMotionsEnabled(f.content, false)
const circularGeometry = { width: 240, height: 240, circular: true }
const circularContext = createContext(circularGeometry)
let safe = createAvatarFace({ ...circularGeometry, bytecode: new ArrayBuffer(0), variables: { 22: 999 } })
check(!!safe.content.behavior.failure && safe.content.behavior.previousCount > 0, 'bad bytecode default recovery')
check(safe.content.width === 240 && safe.content.height === 240, 'decode fallback keeps dimensions')
check(safe.content.behavior.context[2] === circularContext[2], 'decode fallback keeps circular scale')
check(safe.content.behavior.context[22] === circularContext[22], 'decode fallback discards tuning')
safe.dispose()
safe = null
const many = new Uint8Array(22 + 33 * 11 + 1),
  header = new DataView(many.buffer)
header.setUint32(0, 0x53445641, true)
header.setUint16(4, 1, true)
header.setUint16(10, 1, true)
header.setUint16(12, 33 * 11 + 1, true)
for (let i = 0; i < 33; i++) many.set([2, 0, 2, 0, 2, 1, 2, 1, 5, 10, 64], 22 + i * 11)
many[many.length - 1] = 52
safe = createAvatarFace({ bytecode: many.buffer })
check(safe.content.behavior.failure.includes('Piu primitive budget'), 'Piu primitive capacity recovery')
safe.dispose()
safe = null
const infinite = new Uint8Array([65, 86, 68, 83, 1, 0, 0, 0, 0, 0, 1, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 48, 253, 255])
safe = createAvatarFace({ ...circularGeometry, bytecode: infinite.buffer, variables: { 22: 999 } })
check(safe.content.behavior.failure.includes('instruction budget'), 'infinite loop bounded recovery')
check(safe.content.behavior.previousCount > 0 && safe.content.behavior.renderFailures === 1, 'atomic frame recovery')
check(safe.content.behavior.context[2] === circularContext[2], 'runtime fallback keeps circular scale')
check(safe.content.behavior.context[22] === circularContext[22], 'runtime fallback discards tuning')
safe.content.behavior.onFaceUpdate(safe.content, state)
check(safe.content.behavior.context[2] === circularContext[2], 'later fallback frames keep circular scale')
safe.dispose()
safe = null
const first = faces[0],
  b = first.content.behavior
const pool = b.shapes.slice(),
  buffers = [b.vm.stack, b.vm.locals, b.vm.frames, b.vm.commands]
for (let i = 0; i < 12; i++) {
  state.mouth.open = i / 12
  b.onFaceUpdate(first.content, state)
}
for (let i = 0; i < pool.length; i++) check(pool[i] === b.shapes[i], 'bounded Shape pool identity')
check(buffers[0] === b.vm.stack && buffers[3] === b.vm.commands, 'VM buffer identity')
state.mouth.open = 0
trace('AVATAR GEOMETRY PASS\n')
heap('after-render-warmup')
for (let n = 0; n < faces.length; n++) {
  const behavior = faces[n].content.behavior,
    start = Date.now()
  for (let i = 0; i < 120; i++) {
    state.mouth.open = (i % 100) / 100
    state.emotion = i % 6
    behavior.onFaceUpdate(faces[n].content, state)
  }
  trace(`RENDER PREP BENCH ${presets[n]} frames=120 ms=${Date.now() - start}\n`)
  check(!behavior.failure, `preset ${presets[n]} must render without fallback throughout mouth/expression sweep`)
}
heap('after-360-render-preparations')
// XS machine-only timing. Does not measure panel delivery or claim device FPS.
for (const preset of presets) {
  const vm = new AvatarVM(loadPreset(preset)),
    ctx = createContext(),
    start = Date.now()
  let steps = 0,
    draws = 0
  for (let i = 0; i < 500; i++) {
    ctx[8] = ctx[31] = (i % 100) / 100
    ctx[9] = i % 6
    vm.run(ctx)
    steps = Math.max(steps, vm.steps)
    draws = Math.max(draws, vm.count)
  }
  trace(`VM BENCH ${preset} frames=500 ms=${Date.now() - start} maxInstructions=${steps} maxCommands=${draws}\n`)
}
const stage = new Container(null, { left: 0, top: 0, width: 320, height: 240, contents: [first.content] })
let step = 0
export default new Application(null, {
  displayListLength: 4096,
  commandListLength: 4096,
  skin: new Skin({ fill: 'black' }),
  contents: [stage],
  Behavior: class extends Behavior {
    onDisplaying(app) {
      app.interval = 40
      app.start()
    }
    onTimeChanged(app) {
      if (step >= 72) {
        app.stop()
        const f = faces[2],
          behavior = f.content.behavior,
          driver = behavior.driver
        behavior.setMotionsEnabled(f.content, true)
        check(f.content.running, 'motions resume displayed timer')
        behavior.pause(f.content)
        check(!f.content.running, 'pause stops timer')
        const elapsed = driver.elapsed
        Timer.set(() => {
          check(driver.elapsed === elapsed, 'hidden clock must not tick')
          behavior.resume(f.content)
          check(f.content.running, 'restore starts timer')
          behavior.setMotionsEnabled(f.content, false)
          check(!f.content.running, 'motions disabled stop timer')
          stage.remove(f.content)
          check(!driver.displayed && !f.content.application, 'face swap unbind suspends registered timer')
          stage.add(first.content)
          first.content.behavior.setMotionsEnabled(first.content, true)
          check(first.content.running, 'exchanged face resumes')
          first.dispose()
          check(!first.content.running && !first.content.visible, 'dispose stops and hides')
          trace('AVATAR LIFECYCLE PASS\nRENDER COMPLETE\n')
          heap('after-72-render-steps')
        }, 80)
        return
      }
      const index = Math.floor(step / 24),
        item = faces[index],
        behavior = item.content.behavior
      if (step % 24 === 0 && index > 0) {
        const previous = faces[index - 1]
        previous.content.behavior.setMotionsEnabled(previous.content, true)
        check(previous.content.running, 'swap test starts outgoing timer')
        const elapsed = previous.content.behavior.driver.elapsed
        stage.remove(previous.content)
        check(
          !previous.content.behavior.driver.displayed && !previous.content.application,
          'outgoing face unbind suspends registered timer',
        )
        Timer.set(() => {
          check(previous.content.behavior.driver.elapsed === elapsed, 'detached face clock must not tick')
        }, 80)
        stage.add(item.content)
      }
      const sample = Math.floor((step % 24) / 2)
      if (!(step & 1)) {
        state.emotion = sample % 6
        state.eyes.left.open = state.eyes.right.open = sample < 6 ? 1 : 0
        state.eyes.left.gazeX = state.eyes.right.gazeX = sample & 1 ? -1 : 1
        state.eyes.left.gazeY = state.eyes.right.gazeY = (sample % 3) - 1
        state.mouth.open = (sample % 4) / 3
        behavior.onFaceUpdate(item.content, state)
        behavior.invalidator.invalidate(0, 0, 1, 1)
      } else behavior.invalidator.invalidate(0, 0, 320, 240)
      step++
    }
  },
})
