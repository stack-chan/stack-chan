import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildOutputDirectory, firmwareDirectory } from './build-output.mjs'

test('failed XS warm-up removes partial build output and stops before launching workers', {
  skip: process.platform === 'win32',
}, () => {
  const fixture = mkdtempSync(join(tmpdir(), 'stackchan-build-failure-'))
  const names = [basename(fixture), `${basename(fixture)}-next`]
  const log = join(fixture, 'calls.jsonl')
  const generated = names.flatMap((name) =>
    ['tmp', 'bin'].map((kind) => join(buildOutputDirectory, kind, 'lin/mc/debug', name)),
  )
  try {
    for (const name of names) {
      const directory = join(fixture, name)
      mkdirSync(directory)
      writeFileSync(join(directory, 'manifest.test.json'), JSON.stringify({ modules: { main: './main' } }))
    }
    writeFileSync(join(fixture, 'dbus-run-session'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    writeFileSync(
      join(fixture, 'mcconfig'),
      `#!${process.execPath}\n${String.raw`
      const fs = require('node:fs'), path = require('node:path');
      const args = process.argv.slice(2);
      const root = args[args.indexOf('-o') + 1];
      const name = path.basename(path.dirname(args.at(-1)));
      const directories = ['tmp', 'bin'].map(kind => path.join(root, kind, 'lin/mc/debug', name));
      for (const directory of directories) {
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, 'partial.js'), 'emitted before type checking failed');
      }
      fs.appendFileSync(process.env.STACKCHAN_TEST_LOG, JSON.stringify(directories) + '\n');
      process.stderr.write('typescript compile failure\n');
      process.exit(2);
    `}`,
      { mode: 0o755 },
    )
    const environment = { ...process.env }
    for (const key of Object.keys(environment)) if (key.startsWith('STACKCHAN_MODULE_TEST_')) delete environment[key]
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('../run-module-tests.js', import.meta.url)), ...names.map((name) => join(fixture, name))],
      {
        cwd: firmwareDirectory,
        env: {
          ...environment,
          PATH: `${fixture}:${process.env.PATH}`,
          MODDABLE: fixture,
          STACKCHAN_MODULE_TEST_JOBS: '2',
          STACKCHAN_TEST_LOG: log,
        },
        encoding: 'utf8',
        timeout: 15_000,
      },
    )
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stderr, /typescript compile failure/)
    const calls = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    assert.equal(calls.length, 1, 'a failed preparation build must not be retried as a successful test')
    for (const path of calls[0])
      assert.equal(existsSync(path), false, 'failed output cannot satisfy the next make invocation')
  } finally {
    for (const path of generated) rmSync(path, { recursive: true, force: true })
    rmSync(fixture, { recursive: true, force: true })
  }
})
