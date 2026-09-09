import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { syncSamples } from './sync-samples.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'stackchan-gallery-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const inputRoot = join(root, 'firmware')
  const outputRoot = join(root, 'gallery')
  mkdirSync(join(inputRoot, 'example/assets'), { recursive: true })
  mkdirSync(join(outputRoot, 'sample/mod'), { recursive: true })
  writeFileSync(join(inputRoot, 'example/mod.js'), 'export default {}\n')
  writeFileSync(join(inputRoot, 'example/assets/image.png'), Buffer.from([0, 255, 128, 10]))
  writeFileSync(join(inputRoot, 'example/LICENSE'), 'Upstream attribution\n')
  writeFileSync(join(outputRoot, 'sample/mod/mod.js'), 'old source')
  writeFileSync(join(outputRoot, 'sample/archive.xsa'), 'keep archive')
  writeFileSync(join(outputRoot, 'sample/README.md'), 'gallery-specific instructions')
  return {
    inputRoot,
    outputRoot,
    mappings: [{ source: 'example', target: 'sample/mod', files: ['mod.js', 'assets/image.png', 'LICENSE'] }],
  }
}

test('check is read-only; sync preserves binary assets and attribution and is repeatable', (t) => {
  const options = fixture(t)
  const changed = ['sample/mod/mod.js', 'sample/mod/assets/image.png', 'sample/mod/LICENSE']
  assert.deepEqual(syncSamples({ ...options, check: true }), changed)
  assert.equal(readFileSync(join(options.outputRoot, 'sample/mod/mod.js'), 'utf8'), 'old source')
  assert.throws(() => readFileSync(join(options.outputRoot, 'sample/mod/LICENSE')), { code: 'ENOENT' })
  assert.deepEqual(syncSamples(options), changed)
  for (const file of options.mappings[0].files) {
    assert.deepEqual(
      readFileSync(join(options.inputRoot, 'example', file)),
      readFileSync(join(options.outputRoot, 'sample/mod', file))
    )
  }
  assert.deepEqual(syncSamples(options), [])
  assert.deepEqual(syncSamples({ ...options, check: true }), [])
  assert.equal(readFileSync(join(options.outputRoot, 'sample/archive.xsa'), 'utf8'), 'keep archive')
  assert.equal(readFileSync(join(options.outputRoot, 'sample/README.md'), 'utf8'), 'gallery-specific instructions')
  writeFileSync(join(options.inputRoot, 'example/mod.js'), 'updated source')
  assert.deepEqual(syncSamples({ ...options, check: true }), ['sample/mod/mod.js'])
  assert.deepEqual(syncSamples(options), ['sample/mod/mod.js'])
  assert.equal(readFileSync(join(options.outputRoot, 'sample/mod/mod.js'), 'utf8'), 'updated source')
})

test('missing sources fail before any destination changes', (t) => {
  const options = fixture(t)
  options.mappings[0].files.push('missing.js')
  assert.throws(() => syncSamples(options), { code: 'ENOENT' })
  assert.equal(readFileSync(join(options.outputRoot, 'sample/mod/mod.js'), 'utf8'), 'old source')
})

test('ambiguous or escaping mappings are rejected', (t) => {
  const options = fixture(t)
  assert.throws(() => syncSamples({ ...options, mappings: [...options.mappings, ...options.mappings] }), /Duplicate/)
  for (const target of ['../outside', '/absolute', 'sample/../outside', 'sample\\outside']) {
    assert.throws(() => syncSamples({ ...options, mappings: [{ ...options.mappings[0], target }] }), /Invalid/)
  }
  assert.equal(readFileSync(join(options.outputRoot, 'sample/mod/mod.js'), 'utf8'), 'old source')
})

test('CLI check can run outside the repository and rejects unknown flags', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'stackchan-gallery-cli-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const script = new URL('./sync-samples.mjs', import.meta.url)
  const check = spawnSync(process.execPath, [fileURLToPath(script), '--check'], { cwd: root, encoding: 'utf8' })
  assert.equal(check.status, 0, check.stderr + check.stdout)
  const invalid = spawnSync(process.execPath, [fileURLToPath(script), '--invalid'], { cwd: root, encoding: 'utf8' })
  assert.equal(invalid.status, 1)
  assert.match(invalid.stderr, /Usage:/)
})
