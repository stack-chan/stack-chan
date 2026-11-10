// SPDX-License-Identifier: Apache-2.0
import Resource from 'Resource'
import { createContext } from 'avatar-dsl/context'
import { createAvatarFace as createReference } from 'avatar-dsl/face'
import { createAvatarFace as createHistorical } from 'avatar-dsl/historical-face'
import { createAvatarFace as createNative } from 'avatar-dsl/native-face'
import { Application, Container, Skin } from 'piu/MC'
import Timer from 'timer'

const check = (ok, label) => {
  if (!ok) {
    trace(`GROUP CHECK FAILED ${label}\n`)
    throw new Error(label)
  }
}
const bytecode = new Resource('groups.avbc')
const native = createNative({ bytecode, breathSource: 'state', width: 300, height: 220 })
const reference = createReference({ bytecode, width: 300, height: 220 })
native.renderer.setMotionsEnabled(false)
reference.content.behavior.setMotionsEnabled(reference.content, false)
const stage = new Container(null, { left: 7, top: 9, width: 300, height: 220, clip: true })
const ctx = createContext({ width: 300, height: 220 })
const wait = () => new Promise((resolve) => Timer.set(resolve, 60))
const samples = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 8, 6, 4, 2, 0, 10, 1]
async function render() {
  stage.add(native.content)
  await wait()
  const baseline = native.renderer.stats
  const beforeContext = new Float32Array(41),
    commands = new Int32Array(96 * 8)
  for (let i = 0; i < samples.length; i++) {
    ctx[8] = samples[i]
    ctx[11] = samples[i] === 9 ? 0x07e0 : 0
    trace(`GROUP FRAME native ${i} damage\n`)
    native.renderer.snapshot(beforeContext, commands)
    const identical = beforeContext.every((value, index) => value === ctx[index])
    const evaluations = native.renderer.stats.evaluations
    native.renderer.setContext(ctx)
    check(
      native.renderer.stats.evaluations - evaluations === (identical ? 0 : 1),
      'all changed contexts evaluate without cadence reduction',
    )
    // Ensure even an unchanged frame is captured; the one-pixel damage does
    // not conceal stale pixels outside the actual native invalidation.
    native.renderer.invalidate(299, 219, 1, 1)
    await wait()
    trace(`GROUP FRAME native ${i} full\n`)
    native.renderer.invalidate(0, 0, 300, 220)
    await wait()
  }
  const stats = native.renderer.stats
  trace(`GROUP DAMAGE STATS ${JSON.stringify(stats)}\n`)
  check(stats.fullUpdates - baseline.fullUpdates === 2, 'only the two background changes request full damage')
  // Invalid primary color reaches both programs. Neither may publish partial
  // geometry or the requested green background when both executions fail.
  native.renderer.snapshot(beforeContext, commands)
  const published = beforeContext.slice()
  const oldCommands = commands.slice()
  ctx[10] = -1
  ctx[11] = 0x07e0
  native.renderer.setContext(ctx)
  native.renderer.snapshot(beforeContext, commands)
  check(!!native.renderer.failure, 'primary and safe both fail')
  check(
    beforeContext.every((v, i) => v === published[i]),
    'failed publication retains context',
  )
  check(
    commands.every((v, i) => v === oldCommands[i]),
    'failed publication retains commands',
  )
  check(native.renderer.stats.fullUpdates === stats.fullUpdates, 'failed publication retains damage state')
  trace('GROUP FRAME native retain full\n')
  native.renderer.invalidate(0, 0, 300, 220)
  await wait()
  ctx[10] = published[10]
  stage.remove(native.content)
  stage.add(reference.content)
  await wait()
  for (let i = 0; i < samples.length; i++) {
    ctx[8] = samples[i]
    ctx[11] = samples[i] === 9 ? 0x07e0 : 0
    trace(`GROUP FRAME reference ${i} full\n`)
    const b = reference.content.behavior
    b.context.set(ctx)
    b.vm.run(ctx)
    b.present(b.vm)
    b.invalidator.invalidate(0, 0, 300, 220)
    await wait()
  }
  stage.remove(reference.content)
  const historical = createHistorical({ bytecode, width: 300, height: 220 })
  historical.content.behavior.setMotionsEnabled(historical.content, false)
  const hb = historical.content.behavior
  ctx[8] = 0
  ctx[11] = 0
  hb.context.set(ctx)
  hb.vm.run(ctx)
  hb.present(hb.vm)
  trace('GROUP FRAME historical 0 full\n')
  stage.add(historical.content)
  await wait()
  stage.remove(historical.content)
  historical.dispose()
  const extreme = createNative({ bytecode: new Resource('extreme.avbc'), width: 300, height: 220 })
  extreme.renderer.setMotionsEnabled(false)
  check(!extreme.renderer.failure, 'large extent remains valid')
  trace('GROUP FRAME native extreme full\n')
  stage.add(extreme.content)
  await wait()
  stage.remove(extreme.content)
  extreme.dispose()
  // First-frame and runtime failure must publish the complete safe frame.
  for (const backend of ['native', 'reference']) {
    const make = backend === 'native' ? createNative : createReference
    const recovered = make({ bytecode: new Resource('fallback.avbc'), width: 300, height: 220 })
    if (backend === 'native') recovered.renderer.setMotionsEnabled(false)
    else recovered.content.behavior.setMotionsEnabled(recovered.content, false)
    trace(`GROUP FRAME ${backend} fallback initial\n`)
    stage.add(recovered.content)
    await wait()
    const b = recovered.content.behavior
    if (backend === 'native') {
      const c = createContext({ width: 300, height: 220 })
      c[8] = 1
      c[11] = 0x07e0
      recovered.renderer.setContext(c)
      check(!!recovered.renderer.failure, 'runtime fallback selected')
      check(recovered.renderer.stats.fullUpdates === 2, 'fallback background changes request full canvas')
    } else {
      b.desired.mouth.open = 1
      b.desired.theme.secondary = { r: 0, g: 255, b: 0 }
      b.render()
      check(!!b.failure, 'reference runtime fallback selected')
    }
    trace(`GROUP FRAME ${backend} fallback recovered\n`)
    await wait()
    stage.remove(recovered.content)
    recovered.dispose()
    await wait()
  }
  for (const preset of ['default_face', 'omega_mouth', 'aokko_face']) {
    for (const backend of ['native', 'historical']) {
      const make = backend === 'native' ? createNative : createHistorical
      const item = make({
        bytecode: new Resource(backend === 'native' ? `${preset}.avbc` : `upstream-${preset}.avbc`),
        breathSource: 'state',
        width: 300,
        height: 220,
      })
      if (backend === 'native') item.renderer.setMotionsEnabled(false)
      else item.content.behavior.setMotionsEnabled(item.content, false)
      stage.add(item.content)
      await wait()
      const c = createContext({ width: 300, height: 220 })
      c[27] = c[32] = c[33] = 1
      for (let i = 0; i < 6; i++) {
        c[8] = c[31] = i % 2
        c[9] = i
        c[5] = i < 3 ? 1 : 0
        trace(`GROUP FRAME preset ${backend} ${preset} ${i}\n`)
        if (backend === 'native') {
          item.renderer.setContext(c)
          item.renderer.invalidate(0, 0, 300, 220)
        } else {
          const b = item.content.behavior
          b.context.set(c)
          b.vm.run(c)
          b.present(b.vm)
          b.invalidator.invalidate(0, 0, 300, 220)
        }
        await wait()
      }
      stage.remove(item.content)
      item.dispose()
      await wait()
    }
  }
  native.dispose()
  reference.dispose()
  trace('GROUP RENDER COMPLETE\n')
}
export default new Application(null, {
  pixels: 320 * 16,
  displayListLength: 4096,
  commandListLength: 4096,
  skin: new Skin({ fill: 'black' }),
  contents: [stage],
  Behavior: class extends Behavior {
    onDisplaying() {
      Timer.set(render, 60)
    }
  },
})
