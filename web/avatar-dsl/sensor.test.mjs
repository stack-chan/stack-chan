import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { compile } from '../../firmware/tools/avatar-dsl/compiler/compile.js'
import { emit } from '../../firmware/tools/avatar-dsl/compiler/emitter.js'
import { emit as upstreamEmit } from '../../firmware/tools/avatar-dsl/compiler/upstream-emitter.js'
import { parse } from '../../firmware/tools/avatar-dsl/compiler/parser.js'
import { tokenize } from '../../firmware/tools/avatar-dsl/compiler/lexer.js'
import { createContext } from '../../firmware/mods/examples/avatar-dsl/context.js'
import { createRuntime } from './runtime/index.js'

const bytecode = compile(readFileSync(new URL('./samples/mono-sensor.avdsl', import.meta.url), 'utf8'))
const runtime = await createRuntime({ wasmBytes: readFileSync(new URL('./runtime/avds.wasm', import.meta.url)) })
const frame = (open, breath = 1) => {
  const context = createContext()
  context[5] = open
  context[4] = breath
  return runtime.run(bytecode, context)
}
const outside = []
for (let y = 0; y < 240; y++)
  for (let x = 0; x < 320; x++)
    if (Math.hypot(x + 0.5 - 160, y + 0.5 - 112) > 53)
      for (let channel = 0; channel < 3; channel++) outside.push((y * 320 + x) * 4 + channel)
const pixel = (result, x, y) => result.pixels.slice((y * 320 + x) * 4, (y * 320 + x) * 4 + 3)

test('shared compiler fix preserves valid editor presets including dynamic Mono eye', () => {
  const iris = readFileSync(new URL('./samples/iris-lens.avdsl', import.meta.url), 'utf8')
  for (const [name, prefix] of [
    ['mono-sensor', ''],
    ['rounded-eyes', ''],
    ['compound-iris', iris],
  ]) {
    const source = prefix + '\n' + readFileSync(new URL(`./samples/${name}.avdsl`, import.meta.url), 'utf8')
    assert.deepEqual(emit(parse(tokenize(source))), upstreamEmit(parse(tokenize(source))))
  }
})

test('one compiled Mono eye follows native eye_open through closure and reopening within budgets', () => {
  const full = frame(1)
  const closed = frame(0)
  assert.notDeepEqual(pixel(full, 160, 112), pixel(closed, 160, 112))
  assert.deepEqual(frame(0, -1).pixels, closed.pixels, 'closed sensor emits no light')
  for (let i = 0; i <= 100; i++)
    for (const breath of [-1, 0, 1]) {
      const current = frame(i / 100, breath)
      assert.ok(current.primitives.length <= 32)
      assert.ok(current.steps <= 12000)
      // Every changing pixel lies inside the circular shutter drawn at full opening.
      assert.ok(outside.every((index) => current.pixels[index] === full.pixels[index]))
      const circles = Array.from({ length: current.commands.length / 8 }, (_, i) =>
        current.commands.slice(i * 8, i * 8 + 8)
      ).filter((c) => c[0] === 0x41)
      const q = circles[1]?.[3] ?? 0
      for (let n = 0; n < current.commands.length; n += 8) {
        const c = current.commands.slice(n, n + 8)
        if (c[0] !== 0x40) continue
        for (const x of [c[1], c[1] + c[3]])
          for (const y of [c[2], c[2] + c[4]])
            assert.ok(Math.hypot(x - 160, y - 112) <= q, 'sensor rectangles stay inside the aperture')
      }
    }
  assert.deepEqual(frame(1).pixels, full.pixels, 'reopening is deterministic with the same bytecode')
})

test('breath changes sensor emission without moving aperture, rim or seams', () => {
  const low = frame(0.5, -1),
    mid = frame(0.5, 0),
    high = frame(0.5, 1)
  for (let i = 0; i < low.commands.length; i += 8) {
    assert.deepEqual(low.commands.slice(i, i + 7), high.commands.slice(i, i + 7))
  }
  const energy = (result) => pixel(result, 160, 112).reduce((sum, value) => sum + value, 0)
  assert.ok(energy(low) < energy(mid) && energy(mid) < energy(high))
})
