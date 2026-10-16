// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createContext } from '../mods/examples/avatar-dsl/context.js'
import { AvatarVM } from '../mods/examples/avatar-dsl/vm.js'
import { compile } from '../tools/avatar-dsl/compiler/compile.js'
import { buildOutputDirectory } from './lib/build-output.mjs'

const directory = path.join(buildOutputDirectory, 'avatar-dsl-native')
mkdirSync(directory, { recursive: true })
const engine = 'host/modules/ui/components/face/avatar-native'
const executable = path.join(directory, 'engine-test')
const flags = ['-std=c17', '-O2', '-g', '-ffp-contract=off', '-Wall', '-Wextra', '-Werror']
if (process.env.AVDS_SANITIZE) flags.push('-fsanitize=address,undefined', '-fno-omit-frame-pointer')
const build = spawnSync(
  'cc',
  [
    ...flags,
    `-I${engine}`,
    `${engine}/avds-engine.c`,
    'mods/examples/avatar-dsl/tests/native-engine.c',
    '-lm',
    '-o',
    executable,
  ],
  { encoding: 'utf8' },
)
assert.equal(build.status, 0, build.stdout + build.stderr)
const root = 'mods/examples/avatar-dsl'
const fixture = JSON.parse(readFileSync(`${root}/tests/oracle.json`))
writeFileSync(path.join(directory, 'oracle.bin'), JSON.stringify(fixture))
writeFileSync(
  path.join(directory, 'primitive-overflow.avbc'),
  Buffer.from(compile(`fn draw() ${'fill_rect(0,0,1,1,primary) '.repeat(33)} end`)),
)
const cases = []
const add = (label, bytes, context = createContext(), instructions = 12000, draws = 96, expected) => {
  cases.push({ label, bytes: Buffer.from(bytes), context, instructions, draws, expected })
}
const load = (name) => readFileSync(`${root}/${name === 'numeric' ? 'tests' : 'tests/upstream-presets'}/${name}.avbc`)
for (const name of ['default_face', 'omega_mouth', 'aokko_face']) {
  writeFileSync(path.join(directory, `upstream-${name}.avbc`), load(name))
  for (const f of fixture.fixtures.filter((item) => item.name === name))
    add(`adapted ${name}`, readFileSync(`${root}/assets/${name}.avbc`), new Float32Array(f.context))
}
for (const f of fixture.fixtures)
  add(`${f.name} expr=${f.context[9]}`, load(f.name), new Float32Array(f.context), 12000, 96, f.commands)
for (const source of [
  'fn draw() while true do end end',
  'fn draw() while true do fill_rect(0,0,1,1,primary) end end',
  'fn f() f() end fn draw() f() end',
  'fn draw() fill_rect(0,0,1/0,1,primary) end',
  'fn draw() fill_rect(0,0,sqrt(-1),1,primary) end',
  'fn draw() fill_rect(40000,0,1,1,primary) end',
  'fn draw() fill_rect(0,0,-1,1,primary) end',
  'fn draw() fill_rect(0,0,1,1,65536) end',
  'fn draw() begin_group(0,0,1,1) end',
  'fn draw() end_group() end',
  'fn draw() let a=1e38*1e38 fill_rect(0,0,a,1,primary) end',
])
  add(source, compile(source))
function raw(code, locals = 0) {
  const bytes = Buffer.alloc(22 + code.length)
  bytes.writeUInt32LE(0x53445641)
  bytes.writeUInt16LE(1, 4)
  bytes.writeUInt16LE(1, 10)
  bytes.writeUInt16LE(code.length, 12)
  bytes[19] = locals
  bytes.set(code, 22)
  return bytes
}
add('stack underflow', raw([8, 52]))
add('stack overflow', raw([...Array.from({ length: 65 }, () => [2, 1]).flat(), 52]))
add('locals overflow', raw([51, 0, 52], 200))
add('group overflow', raw([...Array.from({ length: 17 }, () => [2, 0, 2, 0, 2, 1, 2, 1, 69]).flat(), 52]))
add('exact instruction budget', raw([0, 52]), createContext(), 1)
add(
  'draw budget',
  compile('fn draw() fill_rect(0,0,1,1,primary) fill_rect(0,0,1,1,primary) end'),
  createContext(),
  12000,
  1,
)
add('maximal code section', raw([...new Uint8Array(65534), 52]))
add('file cap', new Uint8Array(70001))
const original = load('default_face')
for (const n of [0, 15, 16, original.length - 1]) add(`truncated ${n}`, original.subarray(0, n))
for (const [offset, value] of [
  [0, 0],
  [4, 2],
  [6, 1],
  [10, 0],
  [14, 255],
  [16, 4],
]) {
  const bytes = Buffer.from(original)
  bytes[offset] = value
  add(`header/constant ${offset}`, bytes)
}
let seed = 0x12345678
for (let i = 0; i < 500; i++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  const bytes = Buffer.from(original)
  bytes[seed % bytes.length] ^= (seed >>> 16) & 255 || 1
  add(`mutation ${i}`, bytes)
}
for (const index of [0, 2, 15, 31, 40]) {
  const ctx = createContext()
  ctx[index] = Number.NaN
  add(`nonfinite context ${index}`, original, ctx)
}
const records = cases.map((c) => {
  const h = Buffer.alloc(12)
  h.writeUInt32LE(c.bytes.length)
  h.writeUInt32LE(c.instructions, 4)
  h.writeUInt32LE(c.draws, 8)
  return Buffer.concat([h, Buffer.from(c.context.buffer), c.bytes])
})
const run = spawnSync(executable, [], {
  input: Buffer.concat(records),
  maxBuffer: 20000000,
  env: { ...process.env, ASAN_OPTIONS: 'detect_leaks=1:halt_on_error=1' },
})
assert.equal(run.status, 0, String(run.stdout) + String(run.stderr))
const results = String(run.stdout).trim().split('\n').map(JSON.parse)
assert.equal(results.length, cases.length)
for (let i = 0; i < cases.length; i++) {
  const c = cases[i],
    r = results[i]
  let commands,
    error = false
  if (c.expected) commands = c.expected
  else {
    try {
      const vm = new AvatarVM(c.bytes, { instructions: c.instructions, draws: c.draws })
      vm.run(c.context)
      commands = Array.from({ length: vm.count }, (_, j) => Array.from(vm.commands.subarray(j * 8, j * 8 + 8)))
    } catch {
      error = true
    }
  }
  assert.equal(!!r.error, error, `${c.label}: native ${r.message} / JS rejected ${error}`)
  if (!error) assert.deepEqual(r.commands, commands, c.label)
  else assert.equal(r.commands.length, 0, `${c.label}: atomic failure`)
  assert.ok(r.steps <= c.instructions + 1, `${c.label}: bounded execution`)
}
writeFileSync(
  path.join(directory, process.env.AVDS_SANITIZE ? 'sanitized.json' : 'engine-result.json'),
  JSON.stringify(
    {
      cases: cases.length,
      cppOracleCases: fixture.fixtures.length,
      mutations: 500,
      sanitized: !!process.env.AVDS_SANITIZE,
      passed: true,
    },
    null,
    2,
  ),
)
console.log(
  `PASS: ${cases.length} native cases; ${fixture.fixtures.length} pinned C++ command sequences; 500 corruptions; bounded errors; caller mutation; sanitizers=${!!process.env.AVDS_SANITIZE}`,
)
