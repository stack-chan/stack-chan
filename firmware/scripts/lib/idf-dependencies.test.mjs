import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { prepareCoreS3IdfDependencies } from './idf-dependencies.mjs'

test('prepares both managed components without duplicating them', () => {
  const outputDirectory = mkdtempSync(path.join(tmpdir(), 'stackchan-idf-dependencies-'))

  try {
    const manifestPath = prepareCoreS3IdfDependencies({
      outputDirectory,
      platformName: 'm5stackchan_cores3',
      applicationName: 'stack-chan-host',
      mode: 'debug',
    })
    const first = readFileSync(manifestPath, 'utf8')
    prepareCoreS3IdfDependencies({
      outputDirectory,
      platformName: 'm5stackchan_cores3',
      applicationName: 'stack-chan-host',
      mode: 'debug',
    })
    const second = readFileSync(manifestPath, 'utf8')

    assert.equal(second, first)
    assert.equal(count(second, 'espressif/esp_audio_codec:'), 1)
    assert.equal(count(second, 'espressif/esp32-camera:'), 1)
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true })
  }
})

test('prepares the built-in CoreS3 camera dependency', () => {
  const outputDirectory = mkdtempSync(path.join(tmpdir(), 'stackchan-idf-dependencies-'))

  try {
    const manifestPath = prepareCoreS3IdfDependencies({
      outputDirectory,
      platformName: 'm5stack_cores3',
      applicationName: 'stack-chan-host',
      mode: 'release',
    })
    const manifest = readFileSync(manifestPath, 'utf8')

    assert.equal(count(manifest, 'espressif/esp32-camera:'), 1)
    assert.equal(count(manifest, 'espressif/esp_audio_codec:'), 0)
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true })
  }
})

test('uses the generated directory for each ESP32 build mode', () => {
  const outputDirectory = mkdtempSync(path.join(tmpdir(), 'stackchan-idf-dependencies-'))

  try {
    for (const mode of ['debug', 'instrument', 'release']) {
      const manifestPath = prepareCoreS3IdfDependencies({
        outputDirectory,
        platformName: 'm5stackchan_cores3',
        applicationName: 'stack-chan-host',
        mode,
      })
      assert.equal(
        manifestPath,
        path.join(
          outputDirectory,
          'tmp',
          'esp32',
          'm5stackchan_cores3',
          mode,
          'stack-chan-host',
          'xsProj-esp32s3',
          'main',
          'idf_component.yml',
        ),
      )
    }
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true })
  }
})

/**
 * Counts non-overlapping occurrences in a string.
 * @param {string} source - Text to search.
 * @param {string} value - Value to count.
 * @returns {number} Number of occurrences.
 */
function count(source, value) {
  return source.split(value).length - 1
}
