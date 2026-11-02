// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { commandClips } from '../mods/examples/avatar-dsl/clips.js'
import { createContext } from '../mods/examples/avatar-dsl/context.js'
import { AvatarVM } from '../mods/examples/avatar-dsl/vm.js'
import { buildOutputDirectory } from './lib/build-output.mjs'

const directory = path.join(buildOutputDirectory, 'avatar-dsl-damage')
mkdirSync(directory, { recursive: true })
const engine = 'host/modules/ui/components/face/avatar-native',
  exe = path.join(directory, 'render-plan')
const flags = ['-std=c17', '-O2', '-g', '-Wall', '-Wextra', '-Werror']
if (process.env.AVDS_SANITIZE) flags.push('-fsanitize=address,undefined', '-fno-omit-frame-pointer')
const build = spawnSync(
  'cc',
  [...flags, `-I${engine}`, `${engine}/avds-render.c`, 'mods/examples/avatar-dsl/tests/render-plan.c', '-o', exe],
  { encoding: 'utf8' },
)
assert.equal(build.status, 0, build.stdout + build.stderr)
const rect = (x, y, w, h, color = 1) => [64, x, y, w, h, 0, 0, color]
const circle = (x, y, r, color = 1) => [65, x, y, r, 0, 0, 0, color]
const triangle = (x, y, a, b, c, d, color = 1) => [66, x, y, a, b, c, d, color]
const begin = (x, y, w, h) => [69, x, y, w, h, 0, 0, 0],
  end = [70, 0, 0, 0, 0, 0, 0, 0]
const cases = []
const add = (commands, width = 32, height = 24, error = false, label = '') =>
  cases.push({ commands, width, height, error, label })
add(
  [
    begin(4, 3, 7, 6),
    circle(5, 4, 10),
    begin(8, 0, 20, 20),
    rect(0, 0, 32, 24, 2),
    end,
    circle(7, 7, 3, 3),
    end,
    rect(25, 20, 5, 3, 4),
  ],
  32,
  24,
  false,
  'nested/restored/ungrouped',
)
add(
  [begin(20, 20, 0, 3), circle(5, 4, 10), begin(0, 0, 32, 24), rect(0, 0, 32, 24), end, end],
  32,
  24,
  false,
  'empty parent',
)
add([begin(-32768, -32768, 32767, 32767), circle(5, 4, 10), end], 32, 24, false, 'entirely offscreen')
add([begin(32767, 32767, 32767, 32767), circle(32767, 32767, 32767), end], 32, 24, false, 'large sums')
add(
  [...Array.from({ length: 16 }, () => begin(1, 1, 30, 22)), circle(8, 8, 5), ...Array(16).fill(end)],
  32,
  24,
  false,
  'sixteen groups',
)
for (const commands of [
  [end],
  [begin(0, 0, 1, 1)],
  [begin(0, 0, -1, 2), end],
  [...Array(17).fill(begin(0, 0, 1, 1)), ...Array(17).fill(end)],
  Array(33).fill(rect(0, 0, 1, 1)),
])
  add(commands, 32, 24, true, 'malformed/capacity')
let seed = 0x57612398
const random = (n) => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed % n
}
for (let i = 0; i < 1000; i++) {
  const commands = []
  const primitive = () => {
    const x = random(50) - 10,
      y = random(42) - 10,
      color = random(65535)
    const type = random(3)
    return type === 0
      ? rect(x, y, random(24), random(20), color)
      : type === 1
        ? circle(x, y, random(15), color)
        : triangle(x, y, random(50) - 10, random(42) - 10, random(50) - 10, random(42) - 10, color)
  }
  commands.push(primitive(), begin(random(40) - 10, random(30) - 10, random(40), random(30)), primitive())
  commands.push(
    begin(random(40) - 10, random(30) - 10, random(40), random(30)),
    primitive(),
    primitive(),
    end,
    primitive(),
    end,
  )
  if (random(2)) commands.push(primitive()) // removal/addition and slot shifts
  commands.push(rect(12, 7, 10, 9, 65535)) // unchanged foreground must replay
  add(commands)
}
// All current preset oracle contexts: verify the declared groups against the
// ungrouped historical appearance. RGB masks outside groups count as pixels.
const fixture = JSON.parse(readFileSync('mods/examples/avatar-dsl/tests/oracle.json')).fixtures
const presetStart = cases.length
for (const f of fixture.filter((f) => f.name !== 'numeric')) {
  const vm = new AvatarVM(readFileSync(`mods/examples/avatar-dsl/assets/${f.name}.avbc`))
  vm.run(new Float32Array(f.context))
  add(
    Array.from({ length: vm.count }, (_, i) => Array.from(vm.commands.subarray(i * 8, i * 8 + 8))),
    f.context[0],
    f.context[1],
    false,
    f.name,
  )
}
const performanceStart = cases.length,
  workloads = []
for (const name of ['default_face', 'omega_mouth', 'aokko_face']) {
  for (const mode of ['mouth', 'blink', 'breath', 'dynamic']) {
    const start = cases.length,
      vm = new AvatarVM(readFileSync(`mods/examples/avatar-dsl/assets/${name}.avbc`)),
      ctx = createContext()
    ctx[27] = 1
    ctx[32] = ctx[33] = 1
    for (let i = 0; i < 120; i++) {
      ctx[3] = i * 33
      ctx[4] = mode === 'breath' || mode === 'dynamic' ? Math.sin((i * 33 * 2 * Math.PI) / 4000) : 0
      ctx[5] = mode === 'blink' ? (i % 30 < 2 ? 0 : (i % 30) / 30) : 1
      ctx[8] = ctx[31] = mode === 'mouth' || mode === 'dynamic' ? (i % 30) / 29 : 0
      ctx[9] = mode === 'dynamic' ? Math.floor(i / 20) % 6 : 0
      vm.run(ctx)
      add(
        Array.from({ length: vm.count }, (_, j) => Array.from(vm.commands.subarray(j * 8, j * 8 + 8))),
        320,
        240,
        false,
        `${name}/${mode}`,
      )
    }
    workloads.push({ name, mode, start, end: cases.length })
  }
}
const records = cases.map((c) => {
  const header = Buffer.alloc(12)
  header.writeUInt32LE(c.commands.length)
  header.writeUInt32LE(c.width, 4)
  header.writeUInt32LE(c.height, 8)
  const body = Buffer.alloc(c.commands.length * 32)
  c.commands.flat().forEach((v, i) => {
    body.writeInt32LE(v, i * 4)
  })
  return Buffer.concat([header, body])
})
const started = performance.now()
const run = spawnSync(exe, [], {
  input: Buffer.concat(records),
  maxBuffer: 20000000,
  env: { ...process.env, ASAN_OPTIONS: 'detect_leaks=1:halt_on_error=1' },
})
const hostProcessMs = performance.now() - started
assert.equal(run.status, 0, String(run.stdout) + String(run.stderr))
const results = String(run.stdout).trim().split('\n').map(JSON.parse)
assert.equal(results.length, cases.length)
const inside = (x, y, r) => x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3]
// Independent per-pixel oracle: tests the original group stack directly,
// without using the render planner's rectangles/bounds or commandClips.
function image(c, clips = true) {
  const pixels = new Uint16Array(c.width * c.height),
    groups = []
  for (const v of c.commands) {
    if (v[0] === 69) {
      groups.push(v.slice(1, 5))
      continue
    }
    if (v[0] === 70) {
      groups.pop()
      continue
    }
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++) {
        if (clips && groups.some((g) => !inside(x, y, g))) continue
        let covers = false
        if (v[0] === 64) covers = inside(x + 0.5, y + 0.5, v.slice(1, 5))
        else if (v[0] === 65) covers = v[3] > 0 && (x + 0.5 - v[1]) ** 2 + (y + 0.5 - v[2]) ** 2 < v[3] ** 2
        else {
          const cross = (ax, ay, bx, by) => (x + 0.5 - ax) * (by - ay) - (y + 0.5 - ay) * (bx - ax)
          const a = cross(v[1], v[2], v[3], v[4]),
            b = cross(v[3], v[4], v[5], v[6]),
            d = cross(v[5], v[6], v[1], v[2])
          const area = (v[3] - v[1]) * (v[6] - v[2]) - (v[5] - v[1]) * (v[4] - v[2])
          covers = area !== 0 && ((a >= 0 && b >= 0 && d >= 0) || (a <= 0 && b <= 0 && d <= 0))
        }
        if (covers) pixels[y * c.width + x] = v[7]
      }
  }
  return pixels
}
let previous = new Uint16Array(32 * 24),
  incrementalPairs = 0,
  presetAppearancePairs = 0
for (let i = 0; i < performanceStart; i++) {
  const c = cases[i],
    r = results[i]
  assert.equal(!!r.error, c.error, c.label)
  if (c.error) continue
  const js = commandClips(Int32Array.from(c.commands.flat()), c.commands.length, c.width, c.height)
  for (const p of r.primitives) {
    const a = js[p.command]
    assert.deepEqual(p.clip, [a.x, a.y, a.w, a.h], `native/reference clips ${i}`)
    assert.ok(
      p.bounds[0] >= 0 &&
        p.bounds[1] >= 0 &&
        p.bounds[0] + p.bounds[2] <= c.width &&
        p.bounds[1] + p.bounds[3] <= c.height,
    )
  }
  const full = image(c)
  if (i < presetStart) {
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++) if (inside(x, y, r.damage)) previous[y * c.width + x] = full[y * c.width + x]
    assert.deepEqual(previous, full, `continuous damage/full pixels ${i} ${c.label}`)
    previous = full
    incrementalPairs++
  } else {
    assert.deepEqual(
      full,
      image(c, false),
      `adapted preset must retain ungrouped appearance ${c.label} #${i - presetStart}`,
    )
    presetAppearancePairs++
  }
}
const metrics = workloads.map((w) => {
  // First frame per workload is full, irrespective of preceding workload.
  const areas = results.slice(w.start + 1, w.end).map((r) => {
    assert.equal(r.error, 0)
    return r.damage[2] * r.damage[3]
  })
  const pixels = 320 * 240 + areas.reduce((a, b) => a + b, 0)
  let baselineDraws = 1
  for (let i = w.start + 1; i < w.end; i++)
    if (JSON.stringify(cases[i].commands) !== JSON.stringify(cases[i - 1].commands)) baselineDraws++
  const fullPixels = baselineDraws * 320 * 240
  return {
    preset: w.name,
    mode: w.mode,
    evaluations: w.end - w.start,
    baselineDraws,
    damageDraws: 1 + areas.filter((a) => a > 0).length,
    damagePixels: pixels,
    fullPixels,
    rgb565PayloadBytes: pixels * 2,
    fullRgb565PayloadBytes: fullPixels * 2,
    reduction: 1 - pixels / fullPixels,
  }
})
assert.ok(
  metrics.filter((m) => m.mode === 'mouth' || m.mode === 'blink').every((m) => m.reduction > 0.5),
  'localized motion reduces planned payload by at least 50%',
)
const evidence = {
  passed: true,
  cases: cases.length,
  incrementalPairs,
  presetAppearancePairs,
  sanitized: !!process.env.AVDS_SANITIZE,
  hostProcessMs,
  plannerCpuUs: results.reduce((sum, r) => sum + (r.plannerCpuUs ?? 0), 0),
  plannerRuns: results.reduce((sum, r) => sum + (r.plannerRuns ?? 0), 0),
  metrics,
  limitations:
    'Baseline preserves old unchanged-command suppression and counts a full canvas only for changed commands. plannerCpuUs is process CPU clock over 64 repeated C prepare+damage calls per successful case, including a volatile sink, on this host. Host process wall time includes pipe/JSON overhead. Payload is damage area * 2, not measured panel traffic. Per-pixel planner oracle is binary coverage; XS/Piu suite validates real antialiasing.',
}
writeFileSync(
  path.join(directory, process.env.AVDS_SANITIZE ? 'sanitized.json' : 'result.json'),
  JSON.stringify(evidence, null, 2),
)
console.log(
  `PASS ${cases.length} plans, ${incrementalPairs} continuous frames, ${presetAppearancePairs} preserved preset images; host process ${hostProcessMs.toFixed(2)}ms`,
)
console.table(
  metrics.map((m) => ({
    preset: m.preset,
    mode: m.mode,
    reduction: `${(m.reduction * 100).toFixed(1)}%`,
    bytes: m.rgb565PayloadBytes,
  })),
)
