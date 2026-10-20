import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

test('native media adapters initialize on first use, once across callers, and recover after initialization failure', {
  skip: process.platform === 'win32' ? 'requires a POSIX C11/pthreads compiler' : false,
}, () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'stackchan-media-init-'))
  const here = path.dirname(fileURLToPath(import.meta.url))
  const executable = path.join(directory, 'media-init')
  try {
    const compiled = spawnSync(
      process.env.CC ?? 'cc',
      [
        '-std=c11',
        '-Wall',
        '-Wextra',
        '-Werror',
        '-pthread',
        '-I',
        path.join(here, 'media-init/include'),
        path.join(here, '../esp32/media-init.c'),
        path.join(here, 'media-init/main.c'),
        '-o',
        executable,
      ],
      { encoding: 'utf8' },
    )
    assert.ifError(compiled.error)
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr)
    for (const scenario of ['sequential', 'retry', 'concurrent', 'concurrent-retry']) {
      const result = spawnSync(executable, [scenario], { encoding: 'utf8', timeout: 5000 })
      assert.ifError(result.error)
      assert.equal(result.status, 0, `${scenario}: ${result.stdout}${result.stderr}`)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
