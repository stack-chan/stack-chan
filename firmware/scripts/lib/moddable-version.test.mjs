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
  assert.equal(count(rendered, 'CONFIG_APP_PROJECT_VER="9.0.0+stackchan.1"'), 1)
  assert.doesNotMatch(rendered, /CONFIG_APP_PROJECT_VER="8\.3\.1"/)
})

test('formats a readable host API suffix without discarding upstream build metadata', () => {
  assert.equal(STACKCHAN_HOST_API_VERSION, 1)
  assert.equal(firmwareDescriptorVersion('9.0.0'), '9.0.0+stackchan.1')
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
    assert.equal(result.version, '9.0.0+stackchan.1')
    assert.equal(result.directory, path.join(outputDirectory, 'generated', 'sdkconfig', 'm5stackchan_cores3'))
    assert.match(readFileSync(result.filePath, 'utf8'), /CONFIG_APP_PROJECT_VER="9\.0\.0\+stackchan\.1"/)
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
    assert.equal(featureConfig.get('CONFIG_APP_PROJECT_VER'), '"9.5.0+stackchan.1"')
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})
