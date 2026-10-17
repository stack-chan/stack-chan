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
assert.equal(frames.length, 13, log)
const load = (n) => readFileSync(path.join(directory, `frame-${String(n).padStart(3, '0')}.rgba`))
for (let i = 0; i < 6; i++) {
  assert.ok(load(1 + i * 2).equals(load(2 + i * 2)), `partial/full redraw differs in scenario ${i}`)
}
const pixel = (frame, x, y) => load(frame).subarray((y * 320 + x) * 4, (y * 320 + x) * 4 + 3)
assert.ok(pixel(1, 89, 118).equals(pixel(1, 87, 118)), 'transparent glasses corner must reveal the head')
assert.ok(!pixel(1, 89, 118).equals(pixel(1, 0, 0)), 'head must contrast with black')
assert.ok(pixel(1, 89, 85).equals(pixel(1, 0, 0)), 'frame must remain black')
assert.ok(
  pixel(1, 110, 94).every((value) => value >= 248),
  'reflection must remain white in RGB565',
)
assert.ok(load(1).equals(load(3)), 'blink, gaze, emotion must leave the static glasses unchanged')
assert.ok(!load(3).equals(load(5)), 'speech must change the mouth')
assert.ok(!load(5).equals(load(7)), 'background must change with the theme')
const still = load(9)
const breathing = load(11)
// Compare the complete head, including its transparent border, after a 6px move.
for (let y = 54; y < 186; y++) {
  const row = (y * 320 + 54) * 4
  const moved = ((y + 6) * 320 + 54) * 4
  assert.ok(
    still.subarray(row, row + 212 * 4).equals(breathing.subarray(moved, moved + 212 * 4)),
    `breath clipped row ${y}`,
  )
}
console.log('PASS: one static glasses image; blink/gaze, speech, theme, breathing; six partial/full redraw pairs')
