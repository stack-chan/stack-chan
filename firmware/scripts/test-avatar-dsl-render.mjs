// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { buildOutputDirectory } from './lib/build-output.mjs'

const sdk = process.env.MODDABLE
assert.ok(sdk, 'Set MODDABLE to SDK 9.5.0')
const directory = path.join(buildOutputDirectory, 'avatar-dsl-render')
mkdirSync(directory, { recursive: true })
function run(command, args, options = {}) {
  const r = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 20000000, ...options })
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
writeFileSync(path.join(directory, 'build.log'), run('npm', ['run', 'test:avatar-dsl:render:build']))
const log = run(
  runner,
  [path.join(buildOutputDirectory, 'bin/lin/m5stack/debug/avatar-dsl-render/mc.so'), directory, '6'],
  { env: { ...process.env, XSBUG_HOST: '127.0.0.1', XSBUG_PORT: '5099' }, timeout: 12000 },
)
writeFileSync(path.join(directory, 'render.log'), log)
assert.ok(
  log.includes('AVATAR GEOMETRY PASS') && log.includes('AVATAR LIFECYCLE PASS') && log.includes('RENDER COMPLETE'),
  log,
)
const frames = [...log.matchAll(/^FRAME ([0-9a-f]+)$/gm)]
assert.ok(frames.length >= 73, log)
// Linux screen ABI is BGRA. Verify RGB565 red is delivered in the red channel.
const first = readFileSync(path.join(directory, 'frame-001.rgba'))
const collar = (218 * 320 + 10) * 4
assert.deepEqual([...first.subarray(collar, collar + 4)], [0, 0, 248, 255], 'red collar channel packing')
for (let i = 0; i < 36; i++) {
  const load = (n) => readFileSync(path.join(directory, `frame-${String(n).padStart(3, '0')}.rgba`))
  assert.ok(load(1 + i * 2).equals(load(2 + i * 2)), `partial/full redraw ${i} differs`)
}
assert.ok(new Set(frames.slice(0, 73).map((f) => f[1])).size >= 18, 'distinct presets, expressions, blink, gaze, mouth')
console.log(log)
console.log('PASS: 36 partial/full framebuffer pairs; Face lifecycle and recovery; bounded pool; Linux XS timing')
