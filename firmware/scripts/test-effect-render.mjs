import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { buildOutputDirectory } from './lib/build-output.mjs'

const sdk = process.env.MODDABLE
assert.ok(sdk, 'Set MODDABLE to the Moddable SDK')
const directory = path.join(buildOutputDirectory, 'effect-render')
mkdirSync(directory, { recursive: true })

function run(command, args, timeout) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 20_000_000, timeout })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  return result.stdout + result.stderr
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
writeFileSync(path.join(directory, 'build.log'), run('npm', ['run', 'test:effect-render:build']))
const log = run(
  runner,
  [path.join(buildOutputDirectory, 'bin/lin/m5stack/debug/effect-render/mc.so'), directory, '8'],
  15_000,
)
writeFileSync(path.join(directory, 'render.log'), log)
assert.match(log, /EFFECT RENDER COMPLETE/)
const pairsPerEffect = 29
const effects = ['sweat', 'tear', 'thinking', 'idea', 'listening', 'surprised', 'blush', 'shiver']
assert.equal([...log.matchAll(/^FRAME [0-9a-f]+$/gm)].length, 1 + pairsPerEffect * effects.length * 2, log)

function load(frame) {
  return readFileSync(path.join(directory, `frame-${String(frame).padStart(3, '0')}.rgba`))
}

for (const [effectIndex, effect] of effects.entries()) {
  for (let i = 0; i < pairsPerEffect; i++) {
    const frame = 1 + (effectIndex * pairsPerEffect + i) * 2
    assert.ok(load(frame).equals(load(frame + 1)), `${effect} frame ${i}: partial redraw differs from full redraw`)
  }
  const removed = (effectIndex + 1) * pairsPerEffect * 2
  if (effect === 'surprised') {
    const start = 1 + effectIndex * pairsPerEffect * 2
    const firstRows = 320 * 4 * 58
    const after = load(removed).subarray(0, firstRows)
    const before = load(removed - 2).subarray(0, firstRows)
    assert.ok(!load(start).subarray(0, firstRows).equals(after), 'surprise must be visible at the start')
    assert.ok(before.equals(after), 'surprise must disappear while still mounted')
    continue
  }
  assert.ok(!load(removed - 2).equals(load(removed)), `${effect} must be visible on the same face before removal`)
}
console.log(`PASS: ${effects.join(', ')} match full redraw during motion and after removal`)
