import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildVariantMarkerPath, readBuildVariant, resolveBuildVariant, writeBuildVariant } from './build-variant.mjs'

test('build variant marker distinguishes manifests sharing one target directory', () => {
  const directory = mkdtempSync(join(tmpdir(), 'stackchan-build-variant-'))
  try {
    const marker = buildVariantMarkerPath({
      outputDirectory: directory,
      deviceName: 'm5stackchan_cores3',
      mode: 'release',
      applicationName: 'stack-chan-host',
    })
    const normalManifest = join(directory, 'normal.json')
    const diagnosticManifest = join(directory, 'diagnostic.json')

    assert.equal(readBuildVariant(marker), null)
    writeBuildVariant(marker, normalManifest)
    assert.equal(readBuildVariant(marker), resolveBuildVariant(normalManifest))
    assert.notEqual(readBuildVariant(marker), resolveBuildVariant(diagnosticManifest))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
