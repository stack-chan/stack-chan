import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  assertNoCustomBuildOutput,
  buildOutputDirectory,
  firmwareDirectory,
  hostApplicationName,
  moddableOutputArguments,
} from './build-output.mjs'

test('build output configuration is repository-local and stable', () => {
  assert.equal(hostApplicationName, 'stack-chan-host')
  assert.equal(buildOutputDirectory, `${firmwareDirectory}/dist`)
  assert.deepEqual(moddableOutputArguments(), ['-o', buildOutputDirectory])
})

test('custom Moddable output directories are rejected', () => {
  assert.throws(() => assertNoCustomBuildOutput(['-o', '/tmp/elsewhere']), /fixed to/)
  assert.throws(() => assertNoCustomBuildOutput(['-o=/tmp/elsewhere']), /fixed to/)
  assert.doesNotThrow(() => assertNoCustomBuildOutput(['-d', '-m']))
})
