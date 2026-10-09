// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { compile } from '../tools/avatar-dsl/compiler/compile.js'
import { buildOutputDirectory } from './lib/build-output.mjs'

const sdk = process.env.MODDABLE
assert.ok(sdk, 'Set MODDABLE to SDK 9.5.0')
const rotation = Number(process.argv[2] ?? 0)
assert.ok([0, 90, 180, 270].includes(rotation), 'rotation must be 0/90/180/270')
const resources = path.join(buildOutputDirectory, 'avatar-dsl-groups')
const directory = rotation ? `${resources}-r${rotation}` : resources
mkdirSync(resources, { recursive: true })
mkdirSync(directory, { recursive: true })
for (const name of ['default_face', 'omega_mouth', 'aokko_face'])
  writeFileSync(
    path.join(resources, `upstream-${name}.avbc`),
    readFileSync(`mods/examples/avatar-dsl/tests/upstream-presets/${name}.avbc`),
  )
writeFileSync(
  path.join(resources, 'groups.avbc'),
  Buffer.from(
    compile(`
fn draw()
 let s=mouth_open
 -- Change the clip while each primitive is hidden, then reappear in the same
 -- clip: the cached reference must not retain its earlier container bounds.
 let extent=20
 if s == 1 then extent=0 end
 begin_group(245+min(s,1)*10,10,40,20)
 fill_rect(240,10,extent*3,20,0x001F)
 end_group()
 begin_group(245+min(s,1)*10,40,40,20)
 fill_rect(240,40,60,extent,0xF81F)
 end_group()
 begin_group(245+min(s,1)*10,70,40,25)
 fill_circle(270,82,extent*0.9,0x07E0)
 end_group()
 fill_rect(250,130,s,8,0xF800)
 fill_circle(260,160,s,0x07E0)
 if s % 2 == 0 then
   fill_rect(95,145,40,25,0xF800)
   fill_rect(115,155,40,25,0x001F)
 else
   fill_rect(115,155,40,25,0x001F)
   fill_rect(95,145,40,25,0xF800)
 end
 begin_group(210+s,130,25-s,50)
 fill_circle(225,155,25,0x07E0)
 end_group()
 fill_rect(5+s*3,10,25,30,primary)
 begin_group(-5+s*2,30+s,90-s*3,85-s*2)
 fill_circle(35+s*2,65,37,0xF800)
 begin_group(25,20,65,95)
 fill_triangle(10,32,100,88,30,105,0x07E0)
 end_group()
 fill_circle(30,60,10,0x001F)
 if s == 3 then
   begin_group(400,400,20,20)
 elif s == 4 then
   begin_group(20,40,0,30)
 else
   begin_group(10+s*3,45,22,30)
 end
 begin_group(0,0,300,220)
 fill_circle(25,65,40,0xFFFF)
 end_group()
 end_group()
 end_group()
 fill_circle(120+s*2,50,15+s,0xFEA0)
 if s < 7 then fill_rect(90+s*4,85,40,20,0xF81F) end
 fill_rect(30,60,20,25,0x8200)
 fill_triangle(100,30,140,100,80,100,background)
 begin_group(160,50,80,80)
 if s == 10 then
   let i=0
   while i < 15 do begin_group(165+i,55+i,75-i,75-i) i=i+1 end
   fill_circle(190,80,35,primary)
   i=0
   while i < 15 do end_group() i=i+1 end
 else
   fill_circle(195,80,20+s,primary)
 end
 end_group()
 fill_circle(270,185,12,0xF800)
end
`),
  ),
)
writeFileSync(
  path.join(resources, 'fallback.avbc'),
  Buffer.from(
    compile(`fn draw()
 if mouth_open > 0 then while true do end end
 fill_rect(20,20,100,100,0xF800)
end`),
  ),
)
writeFileSync(
  path.join(resources, 'extreme.avbc'),
  Buffer.from(
    compile(`fn draw()
 begin_group(80,35,210,80)
 fill_circle(32767,55,32767,0xF800)
 end_group()
 begin_group(0,0,20,20)
 fill_triangle(-32768,-32768,32767,-32768,0,32767,0x07E0)
 end_group()
 fill_circle(-32768,0,32767,0xFFFF)
end`),
  ),
)
function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 20000000, ...options })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  return r.stdout + r.stderr
}
const flags = run('pkg-config', ['--cflags', '--libs', 'glib-2.0']).trim().split(/\s+/)
const runner = path.join(directory, 'screen-runner')
run('cc', [
  '-DmxLinux=1',
  '-Wall',
  '-Wextra',
  '-Werror',
  `-I${sdk}/build/simulators/modules`,
  'scripts/jitome-face-screen.c',
  '-o',
  runner,
  ...flags,
  '-ldl',
])
writeFileSync(
  path.join(directory, 'build.log'),
  run('npm', ['run', 'test:avatar-dsl:groups:build', '--', '-r', String(rotation)]),
)
const log = run(
  runner,
  [
    path.join(buildOutputDirectory, 'bin/lin/m5stack/debug/avatar-dsl-groups-render/mc.so'),
    directory,
    '12',
    String(rotation),
  ],
  { timeout: 16000, env: { ...process.env, XSBUG_HOST: '127.0.0.1', XSBUG_PORT: '5099' } },
)
writeFileSync(path.join(directory, 'render.log'), log)
assert.ok(log.includes('GROUP RENDER COMPLETE'), log)
let frame = 0,
  label
const frames = new Map()
for (const line of log.split('\n')) {
  if (line.startsWith('GROUP FRAME ')) label = line.slice(12).trim()
  if (/^FRAME [0-9a-f]+$/.test(line)) {
    if (label) {
      assert.ok(!frames.has(label), `duplicate frame ${label}`)
      frames.set(label, frame)
      label = undefined
    }
    frame++
  }
}
const load = (label) => {
  assert.ok(frames.has(label), `missing ${label}\n${log}`)
  const physical = readFileSync(path.join(directory, `frame-${String(frames.get(label)).padStart(3, '0')}.rgba`))
  assert.equal(physical.length, 320 * 240 * 4)
  if (!rotation) return physical
  const logical = Buffer.alloc(physical.length)
  const physicalWidth = rotation === 180 ? 320 : 240
  for (let y = 0; y < 240; y++)
    for (let x = 0; x < 320; x++) {
      const px = rotation === 90 ? 239 - y : rotation === 180 ? 319 - x : y
      const py = rotation === 90 ? x : rotation === 180 ? 239 - y : 319 - x
      physical.copy(logical, (y * 320 + x) * 4, (py * physicalWidth + px) * 4, (py * physicalWidth + px) * 4 + 4)
    }
  return logical
}
const reappeared = load('reference 2 full')
for (const [x, y, primitive] of [
  [250, 15, 'zero-width rect'],
  [250, 45, 'zero-height rect'],
  [254, 82, 'zero-radius circle'],
]) {
  const offset = ((y + 9) * 320 + x + 7) * 4
  assert.deepEqual(
    [...reappeared.subarray(offset, offset + 4)],
    [0, 0, 0, 255],
    `${primitive} reappears with the clip changed while hidden`,
  )
}
for (let i = 0; i < 18; i++) {
  const native = load(`native ${i} damage`)
  assert.ok(native.equals(load(`native ${i} full`)), `native dirty/full ${i}`)
  assert.ok(native.equals(load(`reference ${i} full`)), `native/new-clip-reference ${i}`)
}
assert.ok(load('native retain full').equals(load('native 17 full')), 'both failed VMs retain complete pixels')
for (const mode of ['initial', 'recovered'])
  assert.ok(load(`native fallback ${mode}`).equals(load(`reference fallback ${mode}`)), `fallback ${mode}`)
// Strict clip, ungrouped drawing and AA are actual pixels, not only rectangle
// assertions. A circle crossing the declared top edge cannot paint above it.
const first = load('native 0 damage'),
  pixel = (x, y) => first.subarray(((y + 9) * 320 + x + 7) * 4, ((y + 9) * 320 + x + 7) * 4 + 4)
assert.deepEqual([...pixel(35, 29)], [0, 0, 0, 255], 'AA cannot escape top clip')
assert.deepEqual([...pixel(270, 185)], [0, 0, 248, 255], 'ungrouped circle remains visible')
assert.ok(
  Array.from({ length: 15 }, (_, i) => pixel(120 + i, 35)[2]).some((v) => v > 0 && v < 248),
  'circle AA retained',
)
const historical = load('historical 0 full')
assert.ok(!first.equals(historical), 'old group-hint reference intentionally differs')
const oldBoundary = historical.subarray(((29 + 9) * 320 + 35 + 7) * 4, ((29 + 9) * 320 + 35 + 7) * 4 + 4)
assert.ok(!oldBoundary.equals(pixel(35, 29)), 'recorded old reference paints outside the new group')
const extreme = load('native extreme full'),
  at = (x, y) => [...extreme.subarray(((y + 9) * 320 + x + 7) * 4, ((y + 9) * 320 + x + 7) * 4 + 4)]
assert.deepEqual(at(105, 55), [0, 0, 248, 255], 'wide group and valid circle extent beyond int16 CBox')
assert.deepEqual(at(0, 0), [0, 252, 0, 255], 'extreme triangle coordinates clip safely')
assert.deepEqual(at(79, 55), [0, 0, 0, 255], 'wide clip remains strict')
for (const preset of ['default_face', 'omega_mouth', 'aokko_face'])
  for (let i = 0; i < 6; i++)
    assert.ok(
      load(`preset native ${preset} ${i}`).equals(load(`preset historical ${preset} ${i}`)),
      `preserved historical preset appearance ${preset}/${i}`,
    )
const stats = JSON.parse(log.match(/GROUP DAMAGE STATS (.+)/)[1])
const result = {
  passed: true,
  rotation,
  retainedFailurePairs: 1,
  zeroSizeSlotChanges: true,
  degenerateClipTransitions: 3,
  reorderedOverlap: true,
  clipOnlyChanges: true,
  dirtyFullPairs: 18,
  nativeReferencePairs: 18,
  fallbackPairs: 2,
  historicalPresetPairs: 18,
  intentionalHistoricalDifference: true,
  extremeGeometry: true,
  comparedBytes: 57 * 320 * 240 * 4,
  stats,
  limitations: 'Software XS/Piu raster; device SPI bytes, panel flicker, FPS and CPU unmeasured.',
}
writeFileSync(path.join(directory, 'pixel-result.json'), JSON.stringify(result, null, 2))
console.log(
  `PASS: ${rotation} degrees: 18 continuous native dirty/full and strict-clip JS pairs; 2 fallback pairs; AA, nested groups, screen origin, empty/offscreen clips, unchanged overlap, removal, background; ${stats.damagePixels} planned pixels`,
)
