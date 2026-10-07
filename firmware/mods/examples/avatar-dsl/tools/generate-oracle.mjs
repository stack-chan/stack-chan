// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext } from '../context.js'
import { compile } from '../vendor/compiler/compile.js'

const pin = '419385ef1b875137140085bd50d34dee331f30c2'
const upstream = process.env.AVATAR_DSL_UPSTREAM
assert.ok(upstream, 'Set AVATAR_DSL_UPSTREAM to the pinned checkout (with tl_expected submodule)')
function run(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 10000000 })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  return result.stdout.trim()
}
assert.equal(run('git', ['-C', upstream, 'rev-parse', 'HEAD']), pin)
const root = path.dirname(fileURLToPath(import.meta.url)),
  tmp = path.resolve(root, '../../../../dist/avatar-dsl-oracle')
mkdirSync(tmp, { recursive: true })
const exe = path.join(tmp, 'oracle')
run('g++', [
  '-std=c++20',
  '-O2',
  '-ffp-contract=off',
  `-I${upstream}/components/avatar_vm/include`,
  `-I${upstream}/components/avatar_vm/test/host`,
  `-I${upstream}/components/tl_expected/expected/include`,
  `-I${upstream}/wasm/shim`,
  `${upstream}/components/avatar_vm/vm.cpp`,
  `${upstream}/components/avatar_vm/decoder.cpp`,
  path.resolve(root, '../tests/oracle.cpp'),
  '-o',
  exe,
])
const fixtures = []
for (const name of ['default_face', 'omega_mouth', 'aokko_face', 'numeric']) {
  const source =
    name === 'numeric'
      ? `fn f(a,b) fill_circle(a,b,1,primary) end
fn draw()
 fill_rect(round(-0.5), round(-1.5), floor(3.1 * 7.7 + 0.1), round(0.5), primary)
 fill_rect(-3.9, 1.999, 2 or 7, 2 and 7, primary)
 fill_rect(2 ~= 3, 2 ~= 0, abs(-4.25), sqrt(4), background)
 fill_rect(tx(160.1), ty(120.9), sz(0.1), clamp(8,1,7), secondary)
 let i = 0
 while i < 3 do fill_circle(i, -i, 1, primary) i = i + 1 end
 f(3.1,7.7)
end`
      : readFileSync(path.resolve(root, `../assets/${name}.avdsl`), 'utf8')
  const buffer = Buffer.from(compile(source)),
    bcFile = path.join(tmp, `${name}.avbc`)
  writeFileSync(bcFile, buffer)
  const contexts = []
  for (let expression = 0; expression < 6; expression++) {
    for (let variation = 0; variation < 8; variation++) {
      const ctx = createContext(
        variation === 6
          ? { width: 240, height: 180 }
          : variation === 7
            ? { width: 240, height: 240, circular: true }
            : {},
      )
      ctx[9] = expression
      if (variation === 1) {
        ctx[5] = 0
        ctx[4] = -1
        ctx[8] = ctx[31] = 1
      }
      if (variation === 2) {
        ctx[5] = 0.5
        ctx[6] = 1
        ctx[7] = -1
        ctx[8] = ctx[31] = 0.73
        ctx[4] = -0.5
      }
      if (variation === 3) {
        ctx[16] = 12
        ctx[17] = -8
        ctx[18] = 3
        ctx[19] = -5
        ctx[20] = 10
        ctx[21] = 8
        ctx[15] = 12
      }
      if (variation === 4) {
        ctx[27] = 1
        ctx[32] = ctx[33] = 1
        ctx[10] = 0xf81f
        ctx[11] = 0x07e0
        ctx[12] = 0x001f
      }
      if (variation === 5) {
        ctx[3] = 1234567
        ctx[31] = 0.25
        ctx[8] = 0.85
        ctx[26] = 0
        ctx[4] = 1
      }
      if (variation >= 6) {
        ctx[4] = 0.75
        ctx[6] = -0.75
        ctx[7] = 0.6
        ctx[8] = ctx[31] = 0.333
      }
      contexts.push(ctx)
    }
  }
  const ctxFile = path.join(tmp, 'contexts.bin')
  writeFileSync(ctxFile, Buffer.concat(contexts.map((ctx) => Buffer.from(ctx.buffer))))
  const result = run(exe, [bcFile, ctxFile]).split('\n').map(JSON.parse)
  assert.equal(result.length, contexts.length)
  for (let i = 0; i < contexts.length; i++)
    fixtures.push({ name, context: Array.from(contexts[i]), commands: result[i] })
  if (name === 'numeric') writeFileSync(path.resolve(root, '../tests/numeric.avbc'), buffer)
}
writeFileSync(path.resolve(root, '../tests/oracle.json'), JSON.stringify({ upstream: pin, fixtures }))
console.log(`Recorded ${fixtures.length} unmodified C++ VM cases`)
