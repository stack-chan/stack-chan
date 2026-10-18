#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildOutputDirectory } from './lib/build-output.mjs'
import { resolveModArchivePath } from './lib/mod-flash.mjs'

// Exercise Stack-chan's real mcpack -> mcrun wrapper without deploying a MOD.
const firmware = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtures = path.join(buildOutputDirectory, 'package-mod-regression')
const sourceRoot = mkdtempSync(path.join(tmpdir(), 'stackchan-package-source-'))
process.once('exit', () => rmSync(sourceRoot, { recursive: true, force: true }))
const outcomes = []
for (const kind of ['directory-include', 'missing-package', 'syntax-error']) {
  const directory = path.join(sourceRoot, kind)
  const logDirectory = path.join(fixtures, kind)
  mkdirSync(logDirectory, { recursive: true })
  const archive = resolveModArchivePath({
    outputDirectory: buildOutputDirectory,
    mode: 'release',
    projectName: `stackchan-${kind}`,
  })
  rmSync(directory, { recursive: true, force: true })
  rmSync(archive, { force: true })
  mkdirSync(path.join(directory, 'include'), { recursive: true })
  writeFileSync(
    path.join(directory, 'include/manifest.json'),
    JSON.stringify({ modules: { 'package-message': './message' } }),
  )
  writeFileSync(path.join(directory, 'include/message.js'), 'export default "directory include resolved"\n')
  writeFileSync(
    path.join(directory, 'package.json'),
    JSON.stringify({
      name: `stackchan-${kind}`,
      version: '1.0.0',
      type: 'module',
      main: './mod.js',
      moddable: { manifest: { include: ['./include'], modules: { mod: './mod' } } },
    }),
  )
  const source =
    kind === 'directory-include'
      ? 'import message from "./include/message.js"; export function onLaunch() { trace(message) }\n'
      : kind === 'missing-package'
        ? 'import missing from "stackchan-intentionally-missing-package"; export default missing\n'
        : 'export function {{{ broken\n'
  writeFileSync(path.join(directory, 'mod.js'), source)
  const result = spawnSync(process.execPath, ['scripts/firmware.mjs', 'mod:build', directory, '--mode=release'], {
    cwd: firmware,
    encoding: 'utf8',
    timeout: 120000,
  })
  const log = `${result.stdout ?? ''}${result.stderr ?? ''}`
  writeFileSync(path.join(logDirectory, 'build.log'), log)
  let validArchive = false
  let archiveBytes = 0
  try {
    const bytes = readFileSync(archive)
    archiveBytes = bytes.byteLength
    validArchive =
      bytes.readUInt32BE(0) === bytes.byteLength &&
      bytes.subarray(4, 8).toString() === 'XS_A' &&
      log.includes(`MOD archive=${archive}`)
  } catch {}
  outcomes.push({ kind, status: result.status, validArchive, archiveBytes, log: path.join(logDirectory, 'build.log') })
}
console.log(JSON.stringify(outcomes, null, 2))
for (const { kind, status, validArchive } of outcomes) {
  if (kind === 'directory-include') {
    assert.equal(status, 0, 'directory include package MOD must build')
    assert.equal(validArchive, true, 'successful package MOD must produce an XS archive')
  } else {
    assert.notEqual(status, null, `${kind} must finish normally`)
    assert.notEqual(status, 0, `${kind} must propagate a non-zero exit status`)
    assert.equal(validArchive, false, `${kind} must not leave a usable archive`)
  }
}
