import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

test('actual native binding separates memory capabilities and captures before XS allocation, with or without PSRAM', {
  skip: process.platform === 'win32' ? 'requires a POSIX C compiler' : false,
}, () => {
  const here = path.dirname(fileURLToPath(import.meta.url)),
    directory = mkdtempSync(path.join(tmpdir(), 'stackchan-heap-')),
    executable = path.join(directory, 'heap-test')
  try {
    const compiled = spawnSync(
      process.env.CC ?? 'cc',
      [
        '-std=c11',
        '-Wall',
        '-Wextra',
        '-Werror',
        '-I',
        path.join(here, '__tests__/include'),
        path.join(here, 'memory-heap.c'),
        path.join(here, '__tests__/main.c'),
        '-o',
        executable,
      ],
      { encoding: 'utf8' },
    )
    assert.ifError(compiled.error)
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr)
    const result = spawnSync(executable, [], { encoding: 'utf8', timeout: 5000 })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stdout + result.stderr)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
