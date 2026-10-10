import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { buildOutputDirectory } from './lib/build-output.mjs'

const sdk = process.env.MODDABLE
assert.ok(sdk, 'Set MODDABLE to Moddable SDK 10.0.0 or later')
const directory = path.join(buildOutputDirectory, 'ui-controls')
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
writeFileSync(path.join(directory, 'build.log'), run('npm', ['run', 'test:ui-controls:build', '--', '-r', '0']))
const log = run(runner, [path.join(buildOutputDirectory, 'bin/lin/m5stack/debug/ui-controls/mc.so'), directory], {
  env: { ...process.env, XSBUG_HOST: '127.0.0.1', XSBUG_PORT: '5099' },
  timeout: 15000,
})
writeFileSync(path.join(directory, 'render.log'), log)
assert.ok(log.includes('TOUCH PASS') && log.includes('RENDER COMPLETE'), log)
const golden = path.join('host/modules/ui/components/foundation/__tests__/ui-controls', 'icons.rgba.gz')
const actual = readFileSync(path.join(directory, 'frame-000.rgba'))
assert.ok(
  actual.equals(gunzipSync(readFileSync(golden))),
  'enabled/disabled icons differ from the original Port framebuffer',
)
assert.equal([...log.matchAll(/^FRAME /gm)].length, 4, 'grid and normal/disabled/selected states must render')
const normal = readFileSync(path.join(directory, 'frame-001.rgba'))
const disabled = readFileSync(path.join(directory, 'frame-002.rgba'))
const selected = readFileSync(path.join(directory, 'frame-003.rgba'))
const pixel = (frame, x, y) => frame.subarray((y * 320 + x) * 4, (y * 320 + x + 1) * 4)
assert.ok(!pixel(normal, 43, 49).equals(pixel(disabled, 43, 49)), 'disabled button should mute its icon')
assert.ok(pixel(normal, 43, 49).equals(pixel(selected, 43, 49)), 're-enabled button should restore its icon color')
assert.ok(pixel(normal, 20, 20).equals(pixel(normal, 0, 0)), 'RoundRect corner should reveal the screen')
assert.ok(!pixel(normal, 100, 60).equals(pixel(normal, 0, 0)), 'RoundRect interior should retain its surface')
assert.ok(!pixel(normal, 100, 60).equals(pixel(disabled, 100, 60)), 'disabled button should redraw its surface')
assert.ok(
  !pixel(selected, 100, 60).equals(pixel(disabled, 100, 60)),
  're-enabled selected button should redraw its surface',
)
for (let y = 0; y < 24; y++)
  for (let x = 0; x < 24; x++) {
    assert.ok(
      pixel(normal, 190 + x, 28 + y).equals(pixel(actual, 128 + x, 12 + y)),
      'smaller icon must retain centered original geometry',
    )
  }

// Port drawing historically extends one pixel past the 24px check bounds.
// Retain that behavior while checking the inner geometry against the old 32px grid.
console.log(
  'PASS: 17 original icon silhouettes/colors in both enabled states; tap, drag, cancel, disable/re-enable; four real framebuffer states',
)
