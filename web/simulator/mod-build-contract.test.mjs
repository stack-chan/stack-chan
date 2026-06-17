import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ALLOWED_MOD_BUILD_TARGETS, createModBuildRequest, summarizeBuildArtifact } from './mod-build-contract.mjs'

describe('MOD build contract', () => {
  it('creates a build-service request with allowed targets and workspace paths only', () => {
    const request = createModBuildRequest({
      target: 'esp32/m5stack_cores3',
      entry: 'mod.js',
      files: [
        { path: 'manifest.json', content: '{}' },
        { path: 'mod.js', content: 'export function onRobotCreated() {}' },
      ],
      requestedTransports: ['web-serial', 'ble-serial'],
    })

    assert.equal(request.target, 'esp32/m5stack_cores3')
    assert.equal(request.entry, 'mod.js')
    assert.deepEqual(request.files.map((file) => file.path), ['manifest.json', 'mod.js'])
    assert.deepEqual(request.requestedTransports, ['web-serial', 'ble-serial'])
  })

  it('rejects unknown targets and path traversal before build submission', () => {
    assert.throws(
      () =>
        createModBuildRequest({
          target: 'esp32/unknown',
          entry: 'mod.js',
          files: [{ path: 'mod.js', content: '' }],
        }),
      /unsupported target/
    )

    assert.throws(
      () =>
        createModBuildRequest({
          target: ALLOWED_MOD_BUILD_TARGETS[0],
          entry: '../mod.js',
          files: [{ path: '../secret', content: '' }],
        }),
      /workspace-relative/
    )
  })

  it('summarizes completed build artifacts for transfer preflight', () => {
    assert.deepEqual(
      summarizeBuildArtifact({ artifactName: 'sample.xsa', size: 4096, sha256: 'a'.repeat(64), target: 'esp32/m5stack' }),
      'sample.xsa · esp32/m5stack · 4.0 KB · aaaaaaaa'
    )
  })
})
