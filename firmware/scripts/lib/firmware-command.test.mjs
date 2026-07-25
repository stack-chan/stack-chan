import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const firmwareDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const manifest = 'mods/examples/look_around/manifest.json'

function dryRun(...args) {
  const result = spawnSync(process.execPath, ['scripts/firmware.mjs', 'mod', manifest, ...args], {
    cwd: firmwareDirectory,
    encoding: 'utf8',
    env: { ...process.env, STACKCHAN_BUILD_MODE: '', STACKCHAN_DRY_RUN: '1', npm_config_target: '' },
  })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

test('MOD command keeps debug as the default build mode', () => {
  assert.match(dryRun('-t', 'build'), /mcrun -d -m /)
})

test('MOD command honors the release build mode', () => {
  const output = dryRun('--mode=release', '-t', 'build')
  assert.match(output, /mcrun -m /)
  assert.doesNotMatch(output, /mcrun -d /)
})

test('MOD command installs the instrument archive from its own output directory', () => {
  const output = dryRun('--mode=instrument', '-t', 'build')
  assert.match(output, /mcrun -i -m /)
  assert.match(output, /MOD archive=.*\/bin\/esp32\/instrument\/look_around\/look_around\.xsa/)
})
