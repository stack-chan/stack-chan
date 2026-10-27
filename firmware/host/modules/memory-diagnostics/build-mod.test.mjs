import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

test('ordinary CoreS3 diagnostic MOD command builds for its own host and rejects flash/port arguments', {
  skip: process.platform === 'win32' ? 'requires a POSIX executable fixture' : false,
}, () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'stackchan-memory-mod-')),
    executable = path.join(directory, 'mcrun'),
    capture = path.join(directory, 'arguments.json'),
    firmware = fileURLToPath(new URL('../../../', import.meta.url)),
    script = path.join(firmware, 'scripts/build-memory-diagnostics-mod.mjs')
  try {
    writeFileSync(
      executable,
      `#!/usr/bin/env node
require('node:fs').writeFileSync(process.env.MEMORY_TEST_CAPTURE, JSON.stringify(process.argv.slice(2)))
`,
    )
    chmodSync(executable, 0o755)
    const options = {
      cwd: firmware,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}`, MEMORY_TEST_CAPTURE: capture },
    }
    const result = spawnSync(process.execPath, [script], options)
    assert.equal(result.status, 0, result.stderr)
    const args = JSON.parse(readFileSync(capture, 'utf8'))
    assert.equal(args[args.indexOf('-p') + 1], 'esp32/m5stack_cores3')
    assert.equal(args[args.indexOf('-t') + 1], 'build')
    assert.equal(args[args.indexOf('-o') + 1], path.join(firmware, 'dist'))
    assert.equal(path.basename(args.at(-1)), 'manifest.memory-diagnostics.json')
    rmSync(capture)
    const rejected = spawnSync(process.execPath, [script, '--port', '/dev/fake', '-t', 'deploy'], options)
    assert.equal(rejected.status, 1)
    assert.throws(() => readFileSync(capture), { code: 'ENOENT' })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
