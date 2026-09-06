import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { makeXsArchive, modDefinition } from '../../contracts/testing/xsa-fixture.js'
import { verifyBuiltModArchive } from './mod-package.mjs'

test('native builds detect forgotten data resources and stale archive declarations', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'stackchan-mod-package-'))
  const archive = path.join(root, 'app.xsa'),
    metadata = path.join(root, 'stackchan-mod.json')
  try {
    writeFileSync(archive, makeXsArchive({ metadata: null }))
    assert.equal(verifyBuiltModArchive(archive, metadata).metadata, undefined, 'legacy source has no declaration')
    writeFileSync(metadata, JSON.stringify(modDefinition))
    assert.throws(
      () => verifyBuiltModArchive(archive, metadata),
      (error) => error.code === 'MOD_METADATA_MISSING',
    )
    writeFileSync(archive, makeXsArchive())
    assert.equal(verifyBuiltModArchive(archive, metadata).metadata.id, modDefinition.id)
    writeFileSync(metadata, JSON.stringify({ ...modDefinition, hostApiVersion: 3 }))
    assert.throws(
      () => verifyBuiltModArchive(archive, metadata),
      (error) => error.code === 'MOD_METADATA_MISMATCH',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
