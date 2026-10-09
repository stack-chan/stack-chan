// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { buildOutputDirectory } from './lib/build-output.mjs'

const directory = path.join(buildOutputDirectory, 'avatar-dsl-native')
mkdirSync(directory, { recursive: true })
function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 20000000, ...options })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  return result.stdout + result.stderr
}
// Regenerate the explicit strict-group-clip JS/Piu reference under the same SDK.
writeFileSync(path.join(directory, 'legacy-render.log'), run('npm', ['run', 'test:avatar-dsl:render']))
writeFileSync(path.join(directory, 'build.log'), run('npm', ['run', 'test:avatar-dsl:native:build']))
const runner = path.join(buildOutputDirectory, 'avatar-dsl-render/screen-runner')
const output = path.join(directory, 'frames')
mkdirSync(output, { recursive: true })
const log = run(
  runner,
  [path.join(buildOutputDirectory, 'bin/lin/m5stack/debug/avatar-dsl-native-render/mc.so'), output, '10'],
  {
    env: { ...process.env, XSBUG_HOST: '127.0.0.1', XSBUG_PORT: '5099' },
    timeout: 18000,
  },
)
writeFileSync(path.join(directory, 'render.log'), log)
assert.ok(
  log.includes('NATIVE ORACLE AND SAFETY PASS') &&
    log.includes('NATIVE LIFECYCLE PASS') &&
    log.includes('NATIVE ANIMATION PASS') &&
    log.includes('RENDER COMPLETE'),
  log,
)
const frames = [...log.matchAll(/^FRAME ([0-9a-f]+)$/gm)]
assert.ok(frames.length >= 82 && log.includes('NATIVE CACHED PARTIAL REDRAWS COMPLETE'), log)
for (let i = 1; i <= 73; i++) {
  const name = `frame-${String(i).padStart(3, '0')}.rgba`
  const legacy = readFileSync(path.join(buildOutputDirectory, 'avatar-dsl-render', name))
  const native = readFileSync(path.join(output, name))
  assert.ok(native.equals(legacy), `native/reference framebuffer ${i} differs`)
}
for (let i = 0; i < 36; i++) {
  const load = (n) => readFileSync(path.join(output, `frame-${String(n).padStart(3, '0')}.rgba`))
  assert.ok(load(1 + i * 2).equals(load(2 + i * 2)), `native partial/full ${i} differs`)
}
for (let i = 0; i < 3; i++) {
  const baseline = readFileSync(
    path.join(buildOutputDirectory, 'avatar-dsl-render', `frame-${String(24 + i * 24).padStart(3, '0')}.rgba`),
  )
  for (let n = 0; n < 3; n++) {
    const cached = readFileSync(path.join(output, `frame-${String(74 + i * 3 + n).padStart(3, '0')}.rgba`))
    assert.ok(cached.equals(baseline), `cached full/partial/full preset ${i} step ${n} differs`)
  }
}
writeFileSync(
  path.join(directory, 'pixel-result.json'),
  JSON.stringify(
    {
      matchedFrames: 73,
      cachedRedrawFrames: 9,
      comparedBytes: 82 * 320 * 240 * 4,
      partialFullPairs: 36,
      cachedPartialFullPairs: 3,
      passed: true,
    },
    null,
    2,
  ),
)
console.log(log)
console.log(
  'PASS: 73 native/reference images and 9 cached redraws; 36 state/full pairs and 3 cached partial/full pairs; native animation/lifecycle, oracle and safety',
)
