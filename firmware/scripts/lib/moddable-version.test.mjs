import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  prepareCoreS3VersionSdkconfig,
  readModdableVersion,
  renderCoreS3VersionSdkconfig,
} from './moddable-version.mjs'

test('renders the actual Moddable version without retaining a pinned value', () => {
  const source = `CONFIG_ESP_CONSOLE_UART=y
CONFIG_APP_PROJECT_VER_FROM_CONFIG=y
CONFIG_APP_PROJECT_VER="8.3.1"
CONFIG_SPIRAM=y
`
  const rendered = renderCoreS3VersionSdkconfig(source, '9.0.0')

  assert.match(rendered, /CONFIG_ESP_CONSOLE_UART=y/)
  assert.match(rendered, /CONFIG_SPIRAM=y/)
  assert.equal(count(rendered, 'CONFIG_APP_PROJECT_VER_FROM_CONFIG=y'), 1)
  assert.equal(count(rendered, 'CONFIG_APP_PROJECT_VER="9.0.0"'), 1)
  assert.doesNotMatch(rendered, /CONFIG_APP_PROJECT_VER="8\.3\.1"/)
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

    assert.equal(result.version, '9.0.0')
    assert.equal(result.directory, path.join(outputDirectory, 'generated', 'sdkconfig', 'm5stackchan_cores3'))
    assert.match(readFileSync(result.filePath, 'utf8'), /CONFIG_APP_PROJECT_VER="9\.0\.0"/)
    assert.match(readFileSync(result.partitionFilePath, 'utf8'), /0xFE0000/)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('uses the built-in CoreS3 sdkconfig without custom-platform audio options', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'stackchan-moddable-version-'))
  const moddableDirectory = path.join(fixture, 'moddable')
  const sourceDirectory = path.join(moddableDirectory, 'build/devices/esp32/targets/m5stack_cores3/sdkconfig')
  const outputDirectory = path.join(fixture, 'output')

  try {
    mkdirSync(path.join(moddableDirectory, 'tools'), { recursive: true })
    mkdirSync(sourceDirectory, { recursive: true })
    writeFileSync(path.join(moddableDirectory, 'tools', 'VERSION'), '9.0.0\n')
    writeFileSync(path.join(sourceDirectory, 'partitions.csv'), 'factory,app,factory,0x10000,0xFE0000\n')
    writeFileSync(path.join(sourceDirectory, 'sdkconfig.defaults'), 'CONFIG_BUILTIN_CORES3=y\n')

    const result = prepareCoreS3VersionSdkconfig({
      platformName: 'm5stack_cores3',
      moddableDirectory,
      outputDirectory,
    })

    assert.equal(result.directory, path.join(outputDirectory, 'generated', 'sdkconfig', 'm5stack_cores3'))
    assert.match(readFileSync(result.filePath, 'utf8'), /CONFIG_BUILTIN_CORES3=y/)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('rejects missing and unsafe Moddable versions', () => {
  assert.throws(() => readModdableVersion(''), /MODDABLE environment variable is required/)
  assert.throws(() => renderCoreS3VersionSdkconfig('', '9.0.0"\nCONFIG_FOO=y'), /Invalid Moddable SDK version/)
  assert.throws(() => renderCoreS3VersionSdkconfig('', 'v'.repeat(32)), /Invalid Moddable SDK version/)
})

function count(source, value) {
  return source.split(value).length - 1
}
