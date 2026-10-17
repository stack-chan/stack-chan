import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { buildOutputDirectory } from './lib/build-output.mjs'

const sdk = process.env.MODDABLE
assert.ok(sdk, 'Set MODDABLE to a supported SDK')
const directory = path.join(buildOutputDirectory, 'deal-with-it-render')
mkdirSync(directory, { recursive: true })
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 20000000, ...options })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  return result.stdout + result.stderr
}
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
  ...run('pkg-config', ['--cflags', '--libs', 'glib-2.0']).trim().split(/\s+/),
  '-ldl',
])
writeFileSync(path.join(directory, 'build.log'), run('npm', ['run', 'test:deal-with-it-face-render:build']))
const log = run(
  runner,
  [path.join(buildOutputDirectory, 'bin/lin/m5stack/debug/deal-with-it-render/mc.so'), directory],
  {
    env: { ...process.env, XSBUG_HOST: '127.0.0.1', XSBUG_PORT: '5099' },
    timeout: 15000,
  },
)
writeFileSync(path.join(directory, 'render.log'), log)
assert.ok(log.includes('DEAL WITH IT PASS; RENDER COMPLETE'), log)
const frames = [...log.matchAll(/^FRAME ([0-9a-f]+)$/gm)]
assert.equal(frames.length, 17, log)
const renderedFrames = frames.map((_, n) =>
  readFileSync(path.join(directory, `frame-${String(n).padStart(3, '0')}.rgba`)),
)
const load = (n) => renderedFrames[n]
for (let i = 0; i < 8; i++) {
  assert.ok(load(1 + i * 2).equals(load(2 + i * 2)), `partial/full redraw differs in scenario ${i}`)
}
const pixel = (frame, x, y) => load(frame).subarray((y * 320 + x) * 4, (y * 320 + x) * 4 + 3)
const white = (value) => value.every((channel) => channel >= 248)
assert.ok(pixel(1, 34, 118).equals(pixel(1, 0, 0)), 'outside the outlined glasses must remain transparent')
assert.ok(white(pixel(1, 34, 67)), 'outer contour must be white')
assert.ok(pixel(1, 38, 71).equals(pixel(1, 0, 0)), 'frame must remain black')
assert.ok(white(pixel(1, 70, 79)), 'reflection must remain white')
for (let x = 36; x < 284; x++) {
  assert.ok(pixel(1, x, 70).equals(pixel(1, 0, 0)), 'top bar must remain flat and black')
}
assert.ok(white(pixel(1, 34, 70)) && white(pixel(1, 285, 70)), 'both temple tips must keep their white contour')
assert.ok(
  pixel(1, 33, 70).equals(pixel(1, 0, 0)) && pixel(1, 286, 70).equals(pixel(1, 0, 0)),
  'glasses must stay centered at screen x=160',
)
// Both lenses have 8x8-cell WHITE / BLACK / WHITE diagonals, not merged highlights.
for (const lensOffset of [0, 16]) {
  for (let y = 1; y <= 4; y++) {
    for (let dy = 0; dy < 8; dy++) {
      for (let dx = 0; dx < 8; dx++) {
        const x = 36 + (lensOffset + 3 + y) * 8 + dx
        const screenY = 69 + y * 8 + dy
        assert.ok(pixel(1, x - 8, screenY).equals(pixel(1, 0, 0)), 'first stripe must start at its cell boundary')
        assert.ok(white(pixel(1, x, screenY)), 'first diagonal must be one white cell wide')
        assert.ok(pixel(1, x + 8, screenY).equals(pixel(1, 0, 0)), 'one black cell must separate the white diagonals')
        assert.ok(white(pixel(1, x + 16, screenY)), 'second diagonal must be one white cell wide')
        assert.ok(pixel(1, x + 24, screenY).equals(pixel(1, 0, 0)), 'second stripe must end at its cell boundary')
      }
    }
  }
}
// Compare the complete mouth area against the unmodified SimpleFace render.
for (const [glassesFrame, simpleFrame] of [
  [1, 13],
  [5, 15],
]) {
  const glasses = load(glassesFrame)
  const simple = load(simpleFrame)
  for (let y = 119; y < 178; y++) {
    const row = (y * 320 + 114) * 4
    assert.ok(
      glasses.subarray(row, row + 92 * 4).equals(simple.subarray(row, row + 92 * 4)),
      `simple mouth differs at row ${y}`,
    )
  }
}
assert.ok(load(1).equals(load(3)), 'blink, gaze, emotion must leave the static glasses unchanged')
assert.ok(!load(3).equals(load(5)), 'speech must change the mouth')
assert.ok(!load(5).equals(load(7)), 'background must change with the theme')
const still = load(9)
const breathing = load(11)
// Compare the complete face, including its transparent border, after a 6px move.
for (let y = 54; y < 186; y++) {
  const row = (y * 320 + 28) * 4
  const moved = ((y + 6) * 320 + 28) * 4
  assert.ok(
    still.subarray(row, row + 264 * 4).equals(breathing.subarray(moved, moved + 264 * 4)),
    `breath clipped row ${y}`,
  )
}
console.log(
  'PASS: one static glasses image; blink/gaze, speech, theme, breathing; simple mouth equivalence; eight partial/full redraw pairs',
)
