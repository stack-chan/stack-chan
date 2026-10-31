// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createRuntime } from './index.js'
import { compile } from '../../../firmware/tools/avatar-dsl/compiler/compile.js'
import { createContext } from '../../../firmware/mods/examples/avatar-dsl/context.js'
const root = fileURLToPath(new URL('../../../', import.meta.url))
const runtime = await createRuntime({ wasmBytes: readFileSync(new URL('./avds.wasm', import.meta.url)) })
const preset = (name) => readFileSync(path.join(root, `firmware/mods/examples/avatar-dsl/assets/${name}.avbc`))

test('shared C runtime draws all presets with bounded detached output', () => {
  for (const name of ['default_face', 'omega_mouth', 'aokko_face']) {
    const result = runtime.run(preset(name))
    assert.equal(result.pixels.length, 320 * 240 * 4)
    assert.ok(result.steps > 0 && result.steps <= 12000)
    assert.ok(result.primitives.length > 0 && result.primitives.length <= 32)
    assert.ok(result.pixels.some((v) => v !== 0 && v !== 255))
    const copy = result.pixels.slice()
    runtime.run(preset('default_face'))
    assert.deepEqual(result.pixels, copy)
  }
})
test('native safety budgets and resource limits reject hostile data', () => {
  const bytes = preset('default_face')
  assert.throws(() => runtime.run(bytes, createContext(), { instructions: 1 }), /instruction budget/)
  assert.throws(() => runtime.run(bytes, createContext(), { draws: 1 }), /draw budget/)
  assert.throws(() => runtime.run(new Uint8Array(70001)), /bytecode size/)
  assert.throws(() => runtime.run(bytes, createContext({ width: 1024, height: 1024 })), /resource limit/)
  const invalid = createContext()
  invalid[3] = NaN
  assert.throws(() => runtime.run(bytes, invalid), /context/)
  const corrupt = Uint8Array.from(bytes)
  corrupt[0] ^= 0xff
  assert.throws(() => runtime.run(corrupt), /version\/flags\/counts/)
  assert.throws(() => runtime.run(bytes, createContext(), { draws: 65537 }), /budget/)
  assert.throws(() => runtime.run(compile('fn draw() while true do end end')), /instruction budget/)
  assert.throws(
    () => runtime.run(compile(`fn draw() ${'fill_rect(0,0,1,1,primary) '.repeat(33)} end`)),
    /primitive budget/
  )
  assert.throws(() => runtime.run(compile('fn draw() fill_rect(0,0,1 / 0,1,primary) end')), /division by zero/)
  for (let i = 0; i < bytes.length; i += 31) assert.throws(() => runtime.run(bytes.subarray(0, i)))
  const recovery = runtime.run(bytes)
  assert.equal(recovery.width, 320)
})
test('strict half-open group clipping preserves background outside declared xywh', () => {
  const source = 'fn draw() begin_group(20, 20, 30, 40) fill_circle(20, 20, 60, 0xffff) end_group() end'
  const result = runtime.run(compile(source))
  const white = (x, y) =>
    Array.from(result.pixels.subarray((y * 320 + x) * 4, (y * 320 + x) * 4 + 3)).every((v) => v === 255)
  assert.ok(white(20, 20))
  assert.ok(white(49, 59))
  assert.ok(!white(19, 20))
  assert.ok(!white(50, 20))
  assert.ok(!white(20, 60))
})

test('native and WASM commands, clipping plans and RGB565 pixels agree', { skip: !process.env.AVDS_NATIVE_PARITY }, () => {
  const sdk = process.env.MODDABLE
  const build = path.join(root, 'web/avatar-dsl/.test-output')
  mkdirSync(build, { recursive: true })
  const executable = path.join(build, process.platform === 'win32' ? 'native-runner.exe' : 'native-runner')
  const native = path.join(root, 'firmware/host/modules/ui/components/face/avatar-native')
  const ft = path.join(sdk, 'modules/commodetto/freetype')
  const here = path.dirname(fileURLToPath(import.meta.url))
  const result = spawnSync(
    process.env.CC ?? 'cc',
    [
      '-std=c11',
      '-O2',
      '-DSTANDALONE_',
      '-DFALL_THROUGH=',
      '-ffp-contract=off',
      '-fno-builtin-sin',
      '-fno-builtin-cos',
      '-fno-builtin-tan',
      `-I${here}`,
      `-I${native}`,
      `-I${ft}/src/smooth`,
      `-I${ft}/include`,
      `-I${ft}/include/freetype`,
      `${here}/native-runner.c`,
      `${native}/avds-engine.c`,
      `${native}/avds-render.c`,
      `${ft}/src/smooth/ftgrays.c`,
      '-lm',
      '-o',
      executable,
    ],
    { encoding: 'utf8' }
  )
  assert.equal(result.status, 0, result.error?.message ?? result.stderr)
  const cases = []
  const iris = readFileSync(new URL('../samples/iris-lens.avdsl', import.meta.url), 'utf8')
  for (const name of ['compound']) {
    const bytecode = Buffer.from(
      compile(iris + '\n' + readFileSync(new URL(`../samples/${name}-iris.avdsl`, import.meta.url), 'utf8'))
    )
    for (let i = 0; i < 12; i++) {
      const context = createContext()
      context[5] = (i % 3) / 2
      context[6] = (i % 3) - 1
      context[7] = (i % 2) * 2 - 1
      cases.push({ bytecode, context })
    }
    for (const open of [0, 0.5, 1]) {
      const context = createContext({ width: 128, height: 128 })
      context[5] = open
      cases.push({ bytecode, context })
    }
    for (const open of [0.75, 0.85, 0.9, 0.95, 0.99]) {
      const context = createContext()
      context[5] = open
      context[10] = 0x07ff
      cases.push({ bytecode, context })
    }
  }
  for (const [x, y] of [
    [0, 24],
    [64, 24],
    [32, 0],
    [32, 48],
  ]) {
    const bytecode = Buffer.from(
      compile(`${iris}\nfn draw() begin_group(0,0,64,48) iris_lens(${x},${y},30) end_group() end`)
    )
    for (const open of [0.5, 1]) {
      const context = createContext({ width: 64, height: 48 })
      context[5] = open
      cases.push({ bytecode, context })
    }
  }
  const sensor = Buffer.from(compile(readFileSync(new URL('../samples/mono-sensor.avdsl', import.meta.url), 'utf8')))
  for (let i = 0; i <= 100; i++)
    for (const breath of [-1, 0, 1]) {
      const context = createContext()
      context[5] = i / 100
      context[4] = breath
      cases.push({ bytecode: sensor, context })
    }
  const rounded = compile(readFileSync(new URL('../samples/rounded-eyes.avdsl', import.meta.url), 'utf8'))
  for (let i = 0; i < 12; i++) {
    const context = createContext()
    context[5] = (i % 3) / 2
    context[6] = (i % 3) - 1
    context[7] = (i % 2) * 2 - 1
    context[9] = [0, 1, 5][Math.floor(i / 4)]
    cases.push({ bytecode: Buffer.from(rounded), context })
  }
  for (const name of ['default_face', 'omega_mouth', 'aokko_face']) {
    for (let i = 0; i < 12; i++) {
      const context = createContext()
      context[3] = i * 333
      context[4] = Math.sin(i)
      context[5] = i / 11
      context[6] = Math.sin(i)
      context[7] = Math.cos(i)
      context[8] = i / 11
      context[9] = i % 6
      context[31] = i / 11
      cases.push({ bytecode: preset(name), context })
    }
  }
  for (const source of [
    'fn draw() begin_group(20,20,30,40) fill_circle(20,20,60,0xffff) end_group() end',
    'fn draw() begin_group(-5,0,25,25) begin_group(10,10,20,20) fill_rect(0,0,100,100,0x07e0) end_group() end_group() end',
    'fn draw() fill_circle(160,120,32767,0xffff) end',
  ])
    cases.push({ bytecode: Buffer.from(compile(source)), context: createContext() })
  const input = Buffer.concat(
    cases.map(({ bytecode, context }) => {
      const header = Buffer.alloc(12)
      header.writeUInt32LE(bytecode.length)
      header.writeUInt32LE(12000, 4)
      header.writeUInt32LE(96, 8)
      return Buffer.concat([header, Buffer.from(context.buffer), bytecode])
    })
  )
  const nativeResult = spawnSync(executable, [], { input, maxBuffer: 180 * 1024 * 1024, timeout: 30000 })
  assert.equal(nativeResult.status, 0, nativeResult.stderr?.toString())
  let offset = 0,
    comparedBytes = 0
  for (const sample of cases) {
    const expected = runtime.run(sample.bytecode, sample.context)
    const output = nativeResult.stdout
    const error = output.readUInt32LE(offset),
      count = output.readUInt32LE(offset + 4),
      primitives = output.readUInt32LE(offset + 8),
      steps = output.readUInt32LE(offset + 12)
    offset += 16
    assert.equal(error, 0)
    assert.equal(steps, expected.steps)
    const commandBytes = count * 32
    assert.deepEqual(output.subarray(offset, offset + commandBytes), Buffer.from(expected.commands.buffer))
    offset += commandBytes
    const planBytes = primitives * 36
    const plan = new Int32Array(primitives * 9)
    expected.primitives.forEach((p, i) =>
      plan.set(
        [p.command, p.clip.x, p.clip.y, p.clip.w, p.clip.h, p.bounds.x, p.bounds.y, p.bounds.w, p.bounds.h],
        i * 9
      )
    )
    assert.deepEqual(output.subarray(offset, offset + planBytes), Buffer.from(plan.buffer))
    offset += planBytes
    assert.deepEqual(output.subarray(offset, offset + expected.pixels.length), Buffer.from(expected.pixels.buffer))
    offset += expected.pixels.length
    comparedBytes += expected.pixels.length
  }
  assert.equal(offset, nativeResult.stdout.length)
  writeFileSync(
    path.join(build, 'parity.json'),
    JSON.stringify(
      {
        passed: true,
        frames: cases.length,
        comparedBytes,
        vm: 'shared avds-engine.c',
        planner: 'shared avds-render.c',
        geometry: 'shared avds-outline.h',
        raster: 'Moddable SDK ftgrays.c',
      },
      null,
      2
    )
  )
})

// Optional independently captured Piu/Poco firmware fixture. The capture
// directory is read-only input; no build, device connection or flash occurs.
test(
  'WASM preserves independent firmware silhouettes with bounded AA quantization differences',
  { skip: !process.env.AVDS_FIRMWARE_REFERENCE },
  () => {
    let frames = 0,
      mismatchedPixels = 0,
      maxChannelDelta = 0
    const emotions = [0, 3, 2, 1, 5, 4]
    const presets = ['default_face', 'omega_mouth', 'aokko_face']
    for (let n = 0; n < presets.length; n++)
      for (let sample = 0; sample < 12; sample++) {
        const context = createContext({ variables: { 27: 1, 32: 1 } })
        context[5] = sample < 6 ? 1 : 0
        context[6] = sample & 1 ? -1 : 1
        context[7] = (sample % 3) - 1
        context[8] = context[31] = (sample % 4) / 3
        context[9] = emotions[sample % 6]
        const result = runtime.run(preset(presets[n]), context)
        const bgra = Buffer.alloc(result.pixels.length)
        // SDK simulator exports zero-padded RGB565 as BGRA; browser expands those
        // same 5/6-bit channels to full 8-bit RGBA. Compare their shared 565 pixels.
        for (let i = 0; i < bgra.length; i += 4) {
          bgra[i] = result.pixels[i + 2] & 248
          bgra[i + 1] = result.pixels[i + 1] & 252
          bgra[i + 2] = result.pixels[i] & 248
          bgra[i + 3] = 255
        }
        const frame = 1 + n * 24 + sample * 2
        const name = `frame-${String(frame).padStart(3, '0')}.rgba`
        const captured = readFileSync(path.join(process.env.AVDS_FIRMWARE_REFERENCE, name))
        assert.equal(bgra.length, captured.length)
        let different = 0
        for (let i = 0; i < bgra.length; i += 4) {
          const actual = bgra.subarray(i, i + 3),
            expected = captured.subarray(i, i + 3)
          assert.equal(
            actual.some((v) => v !== 0),
            expected.some((v) => v !== 0),
            `coverage ${name} pixel ${i / 4}`
          )
          const deltas = Array.from(actual, (v, j) => Math.abs(v - expected[j]))
          assert.ok(
            deltas.every((v) => v <= 8),
            `AA channel delta ${name} pixel ${i / 4}`
          )
          if (deltas.some((v) => v !== 0)) different++
          maxChannelDelta = Math.max(maxChannelDelta, ...deltas)
        }
        assert.ok(different / (320 * 240) <= 0.0002, `AA mismatch fraction ${name}`)
        mismatchedPixels += different
        frames++
      }
    const evidence = {
      frames,
      comparedBytes: frames * 320 * 240 * 4,
      mismatchedPixels,
      maxChannelDelta,
      silhouettesExact: true,
    }
    const build = path.join(root, 'web/avatar-dsl/.test-output')
    mkdirSync(build, { recursive: true })
    writeFileSync(path.join(build, 'firmware-reference.json'), JSON.stringify(evidence, null, 2))
    console.log(`Firmware Piu/Poco comparison: ${JSON.stringify(evidence)}`)
  }
)
