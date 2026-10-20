import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  firmwareDescriptorVersion,
  prepareCoreS3VersionSdkconfig,
  prepareVersionSdkconfig,
  readModdableVersion,
  renderCoreS3VersionSdkconfig,
  STACKCHAN_HOST_API_VERSION,
} from './moddable-version.mjs'

test('renders the actual Moddable and Stack-chan host API versions without retaining a pinned value', () => {
  const source = `CONFIG_ESP_CONSOLE_UART=y
CONFIG_APP_PROJECT_VER_FROM_CONFIG=y
CONFIG_APP_PROJECT_VER="8.3.1"
CONFIG_SPIRAM=y
`
  const rendered = renderCoreS3VersionSdkconfig(source, '9.0.0')

  assert.match(rendered, /CONFIG_ESP_CONSOLE_UART=y/)
  assert.match(rendered, /CONFIG_SPIRAM=y/)
  assert.equal(count(rendered, 'CONFIG_APP_PROJECT_VER_FROM_CONFIG=y'), 1)
  assert.equal(count(rendered, `CONFIG_APP_PROJECT_VER="${firmwareDescriptorVersion('9.0.0')}"`), 1)
  assert.doesNotMatch(rendered, /CONFIG_APP_PROJECT_VER="8\.3\.1"/)
})

test('formats a readable host API suffix without discarding upstream build metadata', () => {
  assert.equal(firmwareDescriptorVersion('9.0.0'), firmwareDescriptorVersion('9.0.0', STACKCHAN_HOST_API_VERSION))
  assert.equal(firmwareDescriptorVersion('9.0.0+preview', 2), '9.0.0+preview.stackchan.2')
  assert.throws(() => firmwareDescriptorVersion('9.0.0', 0), /host API version/)
})

test('prepares an SDKCONFIGPATH directory from MODDABLE tools VERSION', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'stackchan-moddable-version-'))
  const moddableDirectory = path.join(fixture, 'moddable')
  const sourceDirectory = path.join(fixture, 'source')
  const outputDirectory = path.join(fixture, 'output')

  try {
    mkdirSync(path.join(moddableDirectory, 'tools'), { recursive: true })
    mkdirSync(path.join(moddableDirectory, 'build/devices/esp32/targets/m5stack_cores3/sdkconfig'), {
      recursive: true,
    })
    mkdirSync(sourceDirectory, { recursive: true })
    writeFileSync(path.join(moddableDirectory, 'tools', 'VERSION'), '9.0.0\n')
    writeFileSync(
      path.join(moddableDirectory, 'build/devices/esp32/targets/m5stack_cores3/sdkconfig/partitions.csv'),
      'factory,app,factory,0x10000,0xFE0000\n',
    )
    writeFileSync(path.join(sourceDirectory, 'sdkconfig.defaults'), 'CONFIG_SPIRAM=y\n')

    const result = prepareCoreS3VersionSdkconfig({ moddableDirectory, outputDirectory, sourceDirectory })

    assert.equal(result.moddableVersion, '9.0.0')
    assert.equal(result.version, firmwareDescriptorVersion(result.moddableVersion))
    assert.equal(result.directory, path.join(outputDirectory, 'generated', 'sdkconfig', 'm5stackchan_cores3'))
    assert.ok(readFileSync(result.filePath, 'utf8').includes(`CONFIG_APP_PROJECT_VER="${result.version}"`))
    assert.match(readFileSync(result.partitionFilePath, 'utf8'), /0xFE0000/)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('rejects missing and unsafe Moddable versions', () => {
  assert.throws(() => readModdableVersion(''), /MODDABLE environment variable is required/)
  assert.throws(() => renderCoreS3VersionSdkconfig('', '9.0.0"\nCONFIG_FOO=y'), /Invalid Moddable SDK version/)
  assert.throws(() => renderCoreS3VersionSdkconfig('', 'v'.repeat(32)), /Invalid Moddable SDK version/)
  assert.throws(() => renderCoreS3VersionSdkconfig('', 'v'.repeat(24)), /firmware descriptor version/)
})

test('the CoreS3 realtime overlay enables Opus while preserving the standalone profile and SDK sources', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'stackchan-opus-config-'))
  try {
    mkdirSync(path.join(fixture, 'tools'))
    writeFileSync(path.join(fixture, 'tools/VERSION'), '10.0.1')
    const sourceDirectory = path.join(fixture, 'profile')
    mkdirSync(sourceDirectory)
    const source =
      'CONFIG_AUDIO_ENCODER_OPUS_SUPPORT=n\nCONFIG_AUDIO_DECODER_OPUS_SUPPORT=n\nCONFIG_AUDIO_DECODER_MP3_SUPPORT=y\n' +
      'CONFIG_SPIRAM_MALLOC_ALWAYSINTERNAL=16384\nCONFIG_SPIRAM_SPEED_40M=y\nCONFIG_ESPTOOLPY_FLASHMODE_DIO=y\n'
    writeFileSync(path.join(sourceDirectory, 'sdkconfig.defaults'), source)
    const partitionSourcePath = path.join(sourceDirectory, 'partitions.csv')
    writeFileSync(partitionSourcePath, 'factory,app,factory,0x10000,0x300000\n')
    const options = {
      moddableDirectory: fixture,
      outputDirectory: path.join(fixture, 'out'),
      sourceDirectory,
      partitionSourcePath,
    }
    const live = prepareCoreS3VersionSdkconfig({ ...options, realtime: true })
    const values = new Map(
      readFileSync(live.filePath, 'utf8')
        .split('\n')
        .filter((line) => line.startsWith('CONFIG_'))
        .map((line) => line.split('=')),
    )
    assert.equal(values.get('CONFIG_AUDIO_ENCODER_OPUS_SUPPORT'), 'y')
    assert.equal(values.get('CONFIG_AUDIO_DECODER_OPUS_SUPPORT'), 'y')
    assert.equal(values.get('CONFIG_AUDIO_DECODER_MP3_SUPPORT'), 'y')
    // Feature allocation policy may change; the board's validated bus timings must survive.
    assert.equal(values.has('CONFIG_SPIRAM_MALLOC_ALWAYSINTERNAL'), false)
    const boardValues = new Map(source.split('\n').map((line) => line.split('=')))
    for (const key of ['CONFIG_SPIRAM_SPEED_40M', 'CONFIG_ESPTOOLPY_FLASHMODE_DIO'])
      assert.equal(values.get(key), boardValues.get(key))
    assert.equal(readFileSync(live.partitionFilePath, 'utf8'), readFileSync(partitionSourcePath, 'utf8'))
    const performance = prepareCoreS3VersionSdkconfig({ ...options, realtime: true, realtimePerformance: true })
    const performanceKeys = new Set(
      readFileSync(performance.filePath, 'utf8')
        .split('\n')
        .map((line) => line.split('=')[0]),
    )
    for (const key of ['CONFIG_SPIRAM_SPEED_40M', 'CONFIG_ESPTOOLPY_FLASHMODE_DIO'])
      assert.equal(
        performanceKeys.has(key),
        false,
        'only the explicit performance profile defers timings to its manifest',
      )
    const normal = prepareCoreS3VersionSdkconfig(options)
    assert.match(readFileSync(normal.filePath, 'utf8'), /CONFIG_AUDIO_ENCODER_OPUS_SUPPORT=n/)
    assert.match(readFileSync(normal.filePath, 'utf8'), /CONFIG_SPIRAM_SPEED_40M=y/)
    assert.equal(readFileSync(path.join(sourceDirectory, 'sdkconfig.defaults'), 'utf8'), source)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

function count(source, value) {
  return source.split(value).length - 1
}

// The SDK merges its base config before feature manifests and the application overlay.
test('base SDK settings are not replayed after feature manifests', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'stackchan-base-config-'))
  try {
    const sourceDirectory = path.join(fixture, 'build/devices/esp32/xsProj-esp32')
    mkdirSync(sourceDirectory, { recursive: true })
    mkdirSync(path.join(fixture, 'tools'))
    writeFileSync(path.join(fixture, 'tools/VERSION'), '9.5.0')
    writeFileSync(path.join(sourceDirectory, 'sdkconfig.defaults'), 'CONFIG_BT_ENABLED=n\nCONFIG_BT_NIMBLE_ENABLED=n\n')
    const partitionSourcePath = path.join(sourceDirectory, 'partitions.csv')
    writeFileSync(partitionSourcePath, 'factory,app,factory,0x10000,0x300000\n')
    const result = prepareVersionSdkconfig({
      platformName: 'm5stack',
      moddableDirectory: fixture,
      outputDirectory: path.join(fixture, 'output'),
      sourceDirectory,
      partitionSourcePath,
    })
    const featureConfig = new Map([
      ['CONFIG_BT_ENABLED', 'y'],
      ['CONFIG_BT_NIMBLE_ENABLED', 'y'],
    ])
    for (const line of readFileSync(result.filePath, 'utf8').split('\n')) {
      if (line.startsWith('CONFIG_')) {
        const index = line.indexOf('=')
        featureConfig.set(line.slice(0, index), line.slice(index + 1))
      }
    }
    assert.equal(featureConfig.get('CONFIG_BT_ENABLED'), 'y')
    assert.equal(featureConfig.get('CONFIG_BT_NIMBLE_ENABLED'), 'y')
    assert.equal(featureConfig.get('CONFIG_APP_PROJECT_VER'), `"${firmwareDescriptorVersion('9.5.0')}"`)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})
