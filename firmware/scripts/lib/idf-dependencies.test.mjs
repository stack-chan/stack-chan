import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { prepareCoreS3IdfDependencies } from './idf-dependencies.mjs'

test('prepares both managed components without duplicating them', () => {
  const outputDirectory = mkdtempSync(path.join(tmpdir(), 'stackchan-idf-dependencies-'))
  const audioManifest = JSON.parse(readFileSync(new URL('../../host/modules/audio/manifest.json', import.meta.url)))
  const audioCodec = audioManifest.platforms['esp32/m5stackchan_cores3'].dependency.find(
    ({ name }) => name === 'esp_audio_codec',
  )

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
    assert.ok(second.includes(`espressif/esp_audio_codec: ${audioCodec.version}`))
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

test('discovers local WebRTC components without editing their sources and isolates measurement builds', async () => {
  const { mkdirSync, writeFileSync, realpathSync, existsSync } = await import('node:fs')
  const outputDirectory = mkdtempSync(path.join(tmpdir(), 'stackchan-realtime-deps-'))
  const solutionDirectory = path.join(outputDirectory, 'solution')
  const names = ['esp_webrtc', 'esp_peer', 'media_lib_utils', 'webrtc_utils', 'av_render']
  for (const name of names) {
    const component = path.join(solutionDirectory, 'components', name)
    mkdirSync(component, { recursive: true })
    writeFileSync(path.join(component, 'CMakeLists.txt'), 'idf_component_register()\n')
  }
  const options = {
    outputDirectory,
    solutionDirectory,
    platformName: 'm5stackchan_cores3',
    applicationName: 'stack-chan-host',
    mode: 'release',
    realtime: true,
  }
  try {
    const manifestPath = prepareCoreS3IdfDependencies({ ...options, performanceProbe: true })
    const components = path.resolve(path.dirname(manifestPath), '../components')
    for (const name of names) {
      assert.equal(
        realpathSync(path.join(components, name)),
        realpathSync(path.join(solutionDirectory, 'components', name)),
      )
      assert.equal(readFileSync(path.join(components, name, 'CMakeLists.txt'), 'utf8'), 'idf_component_register()\n')
    }
    const first = readFileSync(manifestPath, 'utf8')
    assert.ok(existsSync(path.join(components, 'realtime_measurement/CMakeLists.txt')))
    prepareCoreS3IdfDependencies(options)
    assert.ok(!existsSync(path.join(components, 'realtime_measurement')))
    assert.equal(readFileSync(manifestPath, 'utf8'), first)
    assert.equal(count(first, 'espressif/esp_capture:'), 1)
    assert.equal(count(first, 'espressif/esp_sysview:'), 0)
    assert.throws(() => prepareCoreS3IdfDependencies({ ...options, systemTrace: true }), /requires.*performance probe/)
    prepareCoreS3IdfDependencies({ ...options, performanceProbe: true, systemTrace: true })
    assert.equal(count(readFileSync(manifestPath, 'utf8'), 'espressif/esp_sysview:'), 1)
    prepareCoreS3IdfDependencies(options)
    assert.equal(readFileSync(manifestPath, 'utf8'), first)
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true })
  }
})

test('rejects missing WebRTC sources before invoking the SDK', () => {
  const outputDirectory = mkdtempSync(path.join(tmpdir(), 'stackchan-realtime-missing-'))
  try {
    assert.throws(
      () =>
        prepareCoreS3IdfDependencies({
          outputDirectory,
          platformName: 'm5stackchan_cores3',
          applicationName: 'stack-chan-host',
          mode: 'release',
          realtime: true,
          solutionDirectory: path.join(outputDirectory, 'missing'),
        }),
      /Missing WebRTC component/,
    )
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true })
  }
})
