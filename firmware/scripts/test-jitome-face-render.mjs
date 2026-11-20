import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { buildOutputDirectory } from './lib/build-output.mjs'

const sdk = process.env.MODDABLE
assert.ok(sdk, 'Set MODDABLE to Moddable SDK 9.5.0 or later')
const directory = path.join(buildOutputDirectory, 'jitome-face-render')
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
writeFileSync(path.join(directory, 'build.log'), run('npm', ['run', 'test:jitome-face-render:build']))
const log = run(
  runner,
  [path.join(buildOutputDirectory, 'bin/lin/m5stack/debug/jitome-face-render/mc.so'), directory],
  { env: { ...process.env, XSBUG_HOST: '127.0.0.1', XSBUG_PORT: '5099' }, timeout: 15000 },
)
writeFileSync(path.join(directory, 'render.log'), log)
assert.ok(log.includes('GEOMETRY PASS') && log.includes('RENDER COMPLETE'), log)
const frames = [...log.matchAll(/^FRAME ([0-9a-f]+)$/gm)]
assert.equal(frames.length, 33, log)
for (let i = 0; i < 16; i++) {
  const load = (n) => readFileSync(path.join(directory, `frame-${String(n).padStart(3, '0')}.rgba`))
  assert.ok(load(1 + i * 2).equals(load(2 + i * 2)), `partial redraw ${i} differs from full redraw`)
}
assert.ok(new Set(frames.map((f) => f[1])).size >= 10, 'distinct blink, gaze, mouth, and theme images')
console.log(
  'PASS: stationary iris, full closure, brow descent, stable allocations, unchanged-frame skip; 16 partial/full framebuffer pairs',
)
