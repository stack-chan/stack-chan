// SPDX-License-Identifier: Apache-2.0
import Resource from 'Resource'
import { createContext } from 'avatar-dsl/context'
import { allocationStats, NativeVM } from 'avatar-dsl/native'
import { createAvatarFace, loadPreset } from 'avatar-dsl/native-face'
import Debug from 'debug'
import { createFaceState } from 'face-state'
import { Application, Container, Skin } from 'piu/MC'
import Timer from 'timer'

function check(value, message) {
  if (!value) throw new Error(`CHECK FAILED ${message}`)
}
const fixtures = JSON.parse(String.fromArrayBuffer(new Resource('oracle.bin'))).fixtures
const commands = new Int32Array(96 * 8)
for (const f of fixtures) {
  const vm = new NativeVM(new Resource(f.name === 'numeric' ? 'numeric.avbc' : `upstream-${f.name}.avbc`))
  let n
  try {
    n = vm.run(new Float32Array(f.context), commands)
  } catch (error) {
    trace(`NATIVE ORACLE ERROR name=${f.name} expr=${f.context[9]} error=${error}\n`)
    throw error
  }
  check(n === f.commands.length, 'native C++ oracle count')
  for (let i = 0; i < n; i++)
    for (let j = 0; j < 8; j++) check(commands[i * 8 + j] === f.commands[i][j], 'native C++ oracle command')
  vm.close()
}
const presets = ['default', 'omega', 'aokko']
function rejects(action, message) {
  let rejected = false
  try {
    action()
  } catch {
    rejected = true
  }
  check(rejected, message)
}
{
  const vm = new NativeVM(loadPreset())
  const input = new Uint8Array(166),
    output = new Uint8Array(commands.byteLength + 8)
  input.fill(0xa5)
  output.fill(0xa5)
  input.set(new Uint8Array(createContext().buffer), 1)
  vm.run(new DataView(input.buffer, 1, 164), new DataView(output.buffer, 4, commands.byteLength))
  check(
    input[0] === 0xa5 && input[165] === 0xa5 && output[3] === 0xa5 && output[output.length - 4] === 0xa5,
    'bounded unaligned buffer views',
  )
  rejects(() => vm.run.call({}, createContext(), commands), 'native VM receiver validation')
  rejects(() => vm.run(new ArrayBuffer(163), commands), 'native context size validation')
  rejects(() => vm.run(createContext(), new ArrayBuffer(1)), 'native writable output size validation')
  vm.close()
  rejects(() => vm.run(createContext(), commands), 'closed native VM validation')
}
for (const preset of presets) {
  const vm = new NativeVM(loadPreset(preset)),
    ctx = createContext(),
    start = Date.now()
  for (let i = 0; i < 5000; i++) {
    const sample = i % 500 // Repeat the legacy 500-context sweep ten times.
    ctx[8] = ctx[31] = (sample % 100) / 100
    ctx[9] = sample % 6
    vm.run(ctx, commands)
  }
  trace(`NATIVE VM BENCH preset=${preset} frames=5000 wallMs=${Date.now() - start} vmUs=${vm.stats.vmUs}\n`)
  vm.close()
}
const faces = presets.map((preset) => createAvatarFace({ preset, variables: { 27: 1, 32: 1 } }))
for (const f of faces) f.renderer.setMotionsEnabled(false)
const state = createFaceState(),
  snapshot = createContext()
for (let n = 0; n < faces.length; n++) {
  const face = faces[n],
    before = face.renderer.stats,
    start = Date.now()
  for (let i = 0; i < 120; i++) {
    state.mouth.open = (i % 100) / 100
    state.emotion = i % 6
    face.content.behavior.onFaceUpdate(face.content, state)
  }
  const after = face.renderer.stats
  trace(
    `NATIVE PREP BENCH preset=${presets[n]} frames=120 wallMs=${Date.now() - start} vmUs=${after.vmUs - before.vmUs} geometryUs=${after.geometryUs - before.geometryUs} nativeBytes=${after.nativeBytes}\n`,
  )
}
const first = faces[0],
  b = first.content.behavior
rejects(() => first.renderer.setContext.call({}, createContext()), 'native face receiver validation')
b.onFaceUpdate(first.content, state)
const evaluations = first.renderer.stats.evaluations
b.onFaceUpdate(first.content, state)
check(first.renderer.stats.evaluations === evaluations, 'identical context reuse')
const geometry = first.renderer.stats.geometryChanges
const primary = state.theme.primary
state.theme.primary = { r: 255, g: 0, b: 0 }
b.onFaceUpdate(first.content, state)
check(first.renderer.stats.evaluations === evaluations + 1, 'palette evaluates')
check(first.renderer.stats.geometryChanges === geometry, 'palette geometry reuse')
state.theme.primary = primary
b.onFaceUpdate(first.content, state)
const invalid = new Uint8Array([65, 86, 68, 83, 1, 0, 0, 0, 0, 0, 1, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 48, 253, 255])
let safe = createAvatarFace({
  width: 240,
  height: 240,
  circular: true,
  bytecode: invalid.buffer,
  variables: { 22: 999 },
})
check(safe.renderer.failure.includes('instruction budget'), 'bounded infinite loop fallback')
safe.renderer.snapshot(snapshot, commands)
check(
  snapshot[22] === 50 && snapshot[2] === createContext({ width: 240, height: 240, circular: true })[2],
  'safe tuning and geometry',
)
check(safe.renderer.stats.failures === 1, 'fallback counted once')
safe.dispose()
safe = createAvatarFace({ bytecode: new ArrayBuffer(0), breathSource: 'state' })
check(!!safe.renderer.failure && safe.renderer.stats.commands > 0, 'decode fallback')
safe.renderer.setMotionsEnabled(false)
safe.renderer.snapshot(snapshot, commands)
snapshot[4] = 0.875
safe.renderer.setContext(snapshot)
safe.renderer.snapshot(snapshot, commands)
check(snapshot[4] === 0, 'fallback discards custom breath source')
safe.dispose()
safe = createAvatarFace({ bytecode: new Resource('primitive-overflow.avbc') })
check(
  safe.renderer.failure.includes('primitive budget') && safe.renderer.stats.commands > 0,
  'bounded native outline pool fallback',
)
safe.dispose()
safe = createAvatarFace()
safe.renderer.setMotionsEnabled(false)
safe.renderer.snapshot(snapshot, commands)
const publishedBackground = snapshot[11]
snapshot[10] = -1
snapshot[11] = publishedBackground === 0 ? 65535 : 0
safe.renderer.setContext(snapshot)
safe.renderer.snapshot(snapshot, commands)
check(
  !!safe.renderer.failure && snapshot[11] === publishedBackground && safe.renderer.stats.commands > 0,
  'failed primary and fallback retain whole published frame',
)
safe.dispose()
safe = null
Debug.gc()
const allocations = allocationStats()
check(allocations.faces === 3 && allocations.vms === 0, 'native resources reclaimed after GC/close')
for (let i = 0; i < 24; i++) {
  let temporary = createAvatarFace({ bytecode: new ArrayBuffer(0) })
  temporary.dispose()
  temporary = null
}
for (const options of [
  { budget: { instructions: 0 } },
  { bytecode: 'bad' },
  { preset: 'missing' },
  { width: 240, height: 240, circular: true, variables: { 22: Number.NaN } },
]) {
  let temporary = createAvatarFace(options)
  check(
    !!temporary.content.behavior.failure && temporary.renderer.stats.commands > 0,
    'configuration failure safe recovery',
  )
  temporary.dispose()
  temporary = null
}
Debug.gc()
check(allocationStats().faces === 3, 'repeated construction and disposal bounded native memory')
trace('NATIVE ORACLE AND SAFETY PASS\n')
// Match the legacy render fixture's initial frame after its warmup sweep.
state.emotion = 5
state.mouth.open = 0.19
b.onFaceUpdate(first.content, state)
const stage = new Container(null, { left: 0, top: 0, width: 320, height: 240, contents: [first.content] })
let step = 0
export default new Application(null, {
  // Exercise multi-row raster bands against the unchanged small-buffer reference.
  pixels: 320 * 16,
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
        for (let n = 0; n < faces.length; n++) {
          const stats = faces[n].renderer.stats
          check(stats.rasterPasses > 0 && stats.rasterUs > 0, 'native raster markers measure rendered work')
          trace(`NATIVE RASTER SUMMARY preset=${presets[n]} stats=${JSON.stringify(stats)}\n`)
        }
        // Preserve the reference fixture's cleared/disposed terminal image.
        stage.remove(stage.first)
        // Start after the preceding final capture has finished.
        async function verifyNativeAnimation() {
          // Unchanged partial redraws and changed-state damage both retain their
          // native dirty regions; full redraws below provide the pixel oracle.
          const wait = () => new Promise((resolve) => Timer.set(resolve, 40))
          for (const item of faces) {
            item.renderer.setMotionsEnabled(false)
            if (stage.first) stage.remove(stage.first)
            stage.add(item.content)
            await wait()
            item.renderer.invalidate(110, 60, 70, 120)
            await wait()
            item.renderer.invalidate(0, 0, 320, 240)
            await wait()
          }
          trace('NATIVE CACHED PARTIAL REDRAWS COMPLETE\n')
          const face = faces[2]
          let jsTicks = 0
          face.renderer.behavior = new (class extends Behavior {
            onTimeChanged() {
              jsTicks++
            }
          })()
          face.renderer.setMotionsEnabled(true)
          check(face.renderer.running, 'native timer resumes')
          Timer.set(() => {
            check(face.renderer.stats.ticks > 0 && jsTicks === 0, 'native animation never calls JS onTimeChanged')
            const before = face.renderer.stats
            for (let i = 0; i < 20; i++) {
              state.mouth.open = i / 20
              face.content.behavior.onFaceUpdate(face.content, state)
            }
            check(
              face.renderer.stats.evaluations === before.evaluations,
              'active state writes share native evaluation clock',
            )
            face.content.visible = false
            check(!face.renderer.running, 'root visibility stops native timer')
            face.content.visible = true
            check(face.renderer.running, 'root visibility restores native timer')
            face.content.behavior.pause(face.content)
            check(!face.renderer.running, 'pause stops native timer')
            const elapsed = face.renderer.stats.elapsed
            Timer.set(() => {
              check(face.renderer.stats.elapsed === elapsed, 'hidden clock freezes')
              face.content.behavior.resume(face.content)
              check(face.renderer.running, 'resume restarts native timer')
              stage.remove(face.content)
              check(!face.renderer.running, 'unbind stops native timer')
              stage.add(first.content)
              first.renderer.setMotionsEnabled(true)
              check(first.renderer.running, 'swap resumes native timer')
              state.eyes.left.open = state.eyes.right.open = 1
              first.content.behavior.onFaceUpdate(first.content, state)
              let minimum = 1,
                positive = false,
                negative = false,
                samples = 0
              const probe = Timer.repeat(() => {
                const elapsed = first.renderer.stats.elapsed
                if (!elapsed) return // Wait for the coalesced state update's first native tick.
                first.renderer.snapshot(snapshot, commands)
                const t = elapsed % 4000
                const expected =
                  t < 2800 ? 1 : t < 2890 ? 1 - (t - 2800) / 90 : t < 2935 ? 0 : t < 3135 ? (t - 2935) / 200 : 1
                check(
                  snapshot[3] === elapsed && snapshot[5] === Math.fround(expected),
                  'native elapsed and blink match reference',
                )
                check(
                  Math.abs(snapshot[4] - Math.fround(Math.sin((elapsed * 2 * Math.PI) / 4000))) < 1e-7,
                  'native breath matches reference',
                )
                minimum = Math.min(minimum, snapshot[5])
                positive ||= snapshot[4] > 0.5
                negative ||= snapshot[4] < -0.5
                samples++
              }, 20)
              Timer.set(() => {
                Timer.clear(probe)
                check(
                  samples > 50 && minimum < 0.4 && positive && negative,
                  'native automatic blink and complete breath cycle',
                )
                trace(`NATIVE ANIMATION PASS samples=${samples} minimumEyeOpen=${minimum}\n`)
                first.dispose()
                check(!first.renderer.running && !first.content.visible, 'dispose stops and hides')
                first.dispose()
                Debug.gc()
                trace('NATIVE LIFECYCLE PASS\nRENDER COMPLETE\n')
              }, 4200)
            }, 80)
          }, 100)
        }
        Timer.set(verifyNativeAnimation, 40)
        return
      }
      const index = Math.floor(step / 24),
        item = faces[index]
      if (step % 24 === 0 && index > 0) {
        const previous = faces[index - 1]
        previous.renderer.setMotionsEnabled(true)
        stage.remove(previous.content)
        check(!previous.renderer.running, 'swap stops outgoing native timer')
        stage.add(item.content)
      }
      const sample = Math.floor((step % 24) / 2)
      if (!(step & 1)) {
        state.emotion = sample % 6
        state.eyes.left.open = state.eyes.right.open = sample < 6 ? 1 : 0
        state.eyes.left.gazeX = state.eyes.right.gazeX = sample & 1 ? -1 : 1
        state.eyes.left.gazeY = state.eyes.right.gazeY = (sample % 3) - 1
        state.mouth.open = (sample % 4) / 3
        item.content.behavior.onFaceUpdate(item.content, state)
        item.renderer.invalidate(0, 0, 1, 1)
      } else item.renderer.invalidate(0, 0, 320, 240)
      step++
    }
  },
})
