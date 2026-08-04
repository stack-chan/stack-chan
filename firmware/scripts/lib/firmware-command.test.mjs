import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const firmwareDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const manifest = 'mods/examples/look_around/manifest.json'

function dryRun(...args) {
  return dryRunCommand('mod', ...args)
}

function dryRunCommand(command, ...args) {
  const result = spawnSync(process.execPath, ['scripts/firmware.mjs', command, manifest, ...args], {
    cwd: firmwareDirectory,
    encoding: 'utf8',
    env: { ...process.env, STACKCHAN_BUILD_MODE: '', STACKCHAN_DRY_RUN: '1', npm_config_target: '' },
  })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

test('built-in CoreS3 command selects its matching platform and manifest', () => {
  const result = spawnSync(process.execPath, ['scripts/firmware.mjs', 'build', 'm5stack_cores3'], {
    cwd: firmwareDirectory,
    encoding: 'utf8',
    env: { ...process.env, STACKCHAN_DRY_RUN: '1', npm_config_target: '' },
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /platform=esp32\/m5stack_cores3/)
  assert.match(result.stdout, /manifest=\.\/host\/app\/manifest_local\.json/)
})

test('MOD command keeps debug as the default build mode', () => {
  assert.match(dryRun('-t', 'build'), /mcrun -d -m /)
})

test('MOD command honors the release build mode', () => {
  const output = dryRun('--mode=release', '-t', 'build')
  assert.match(output, /mcrun -m /)
  assert.doesNotMatch(output, /mcrun -d /)
})

test('MOD command installs the instrument archive from its own output directory', () => {
  const output = dryRun('--mode=instrument', '-t', 'build')
  assert.match(output, /mcrun -i -m /)
  assert.match(output, /MOD archive=.*\/bin\/esp32\/instrument\/look_around\/look_around\.xsa/)
})

test('MOD build command produces a release archive without planning a device write', () => {
  const output = dryRunCommand('mod:build', '--mode=release', '-t', 'build')
  assert.match(output, /mcrun -m /)
  assert.match(output, /MOD archive=.*\/bin\/esp32\/release\/look_around\/look_around\.xsa/)
  assert.doesNotMatch(output, /esptool will discover/)
})

test('firmware wrapper cleans manifest switches before every CoreS3 command and restores IDF dependencies', () => {
  for (const deviceName of ['m5stack_cores3', 'm5stackchan_cores3']) {
    for (const command of ['build', 'flash', 'deploy', 'debug']) {
      const fixture = createFirmwareWrapperFixture(deviceName)
      const label = `${deviceName}/${command}`
      try {
        const first = runFixture(fixture, command, fixture.normalManifest)
        assert.equal(count(first.stdout, 'prepared IDF dependencies:'), 2, `${label}: first build preparation`)
        let invocations = readInvocations(fixture.commandLog)
        assertCommandPair(invocations, command, fixture.normalManifest, fixture.platform)

        const same = runFixture(fixture, command, fixture.normalManifest)
        assert.equal(count(same.stdout, 'prepared IDF dependencies:'), 1, `${label}: same variant preparation`)
        invocations = readInvocations(fixture.commandLog)
        assert.equal(invocations.length, 3, `${label}: same variant must not clean`)
        assertMainCommand(invocations[2], command, fixture.normalManifest, fixture.platform)

        const switched = runFixture(fixture, command, fixture.diagnosticManifest)
        assert.equal(count(switched.stdout, 'prepared IDF dependencies:'), 2, `${label}: switched preparation`)
        invocations = readInvocations(fixture.commandLog)
        assert.equal(invocations.length, 5)
        assertCommandPair(invocations.slice(3), command, fixture.diagnosticManifest, fixture.platform)
      } finally {
        rmSync(fixture.root, { recursive: true, force: true })
      }
    }
  }
})

function createFirmwareWrapperFixture(deviceName) {
  const root = mkdtempSync(path.join(tmpdir(), 'stackchan-firmware-wrapper-'))
  const fixtureFirmware = path.join(root, 'firmware')
  const fixtureWebEditor = path.join(root, 'web', 'editor')
  const sourceSdkconfig = path.join(
    firmwareDirectory,
    'host',
    'modules',
    'audio',
    'platforms',
    'm5stackchan-cores3',
    'sdkconfig',
  )
  mkdirSync(fixtureFirmware, { recursive: true })
  cpSync(path.join(firmwareDirectory, 'scripts'), path.join(fixtureFirmware, 'scripts'), { recursive: true })
  cpSync(
    sourceSdkconfig,
    path.join(fixtureFirmware, 'host', 'modules', 'audio', 'platforms', 'm5stackchan-cores3', 'sdkconfig'),
    { recursive: true },
  )
  mkdirSync(fixtureWebEditor, { recursive: true })
  cpSync(
    path.resolve(firmwareDirectory, '../web/editor/esptool-installer.mjs'),
    path.join(fixtureWebEditor, 'esptool-installer.mjs'),
  )
  cpSync(
    path.resolve(firmwareDirectory, '../web/editor/mod-builder.mjs'),
    path.join(fixtureWebEditor, 'mod-builder.mjs'),
  )

  const fakeModdable = path.join(root, 'moddable')
  mkdirSync(path.join(fakeModdable, 'tools'), { recursive: true })
  writeFileSync(path.join(fakeModdable, 'tools', 'VERSION'), '8.3.1\n')
  const partitionDirectory = path.join(
    fakeModdable,
    'build',
    'devices',
    'esp32',
    'targets',
    'm5stack_cores3',
    'sdkconfig',
  )
  mkdirSync(partitionDirectory, { recursive: true })
  writeFileSync(path.join(partitionDirectory, 'partitions.csv'), '# test partition table\n')
  writeFileSync(path.join(partitionDirectory, 'sdkconfig.defaults'), '# test sdkconfig\n')

  const appDirectory = path.join(fixtureFirmware, 'host', 'app')
  mkdirSync(appDirectory, { recursive: true })
  const normalManifest = path.join(appDirectory, 'manifest_android_usb_audio.json')
  const diagnosticManifest = path.join(appDirectory, 'manifest_android_usb_audio_diagnostics.json')
  writeFileSync(normalManifest, '{}\n')
  writeFileSync(diagnosticManifest, '{}\n')

  const fakeBin = path.join(root, 'bin')
  const commandLog = path.join(root, 'mcconfig.jsonl')
  mkdirSync(fakeBin, { recursive: true })
  const fakeMcconfig = path.join(fakeBin, 'mcconfig')
  const dependencyMarker =
    deviceName === 'm5stackchan_cores3' ? 'espressif/esp_audio_codec:' : 'espressif/esp32-camera:'
  writeFileSync(
    fakeMcconfig,
    `#!/usr/bin/env node
const { appendFileSync, existsSync, readFileSync, rmSync } = require('node:fs')
const path = require('node:path')

const args = process.argv.slice(2)
appendFileSync(process.env.STACKCHAN_TEST_COMMAND_LOG, JSON.stringify(args) + '\\n')
const outputIndex = args.indexOf('-o')
const outputDirectory = args[outputIndex + 1]
const idfManifest = path.join(
  outputDirectory,
  'tmp',
  'esp32',
  '${deviceName}',
  'instrument',
  'stack-chan-host',
  'xsProj-esp32s3',
  'main',
  'idf_component.yml',
)
const targetIndex = args.indexOf('-t')
if (targetIndex >= 0 && args[targetIndex + 1] === 'clean') {
  rmSync(idfManifest, { force: true })
} else if (
  !existsSync(idfManifest) ||
  !readFileSync(idfManifest, 'utf8').includes('${dependencyMarker}')
) {
  process.exit(12)
}
`,
  )
  chmodSync(fakeMcconfig, 0o755)

  return {
    root,
    firmware: fixtureFirmware,
    fakeBin,
    fakeModdable,
    commandLog,
    deviceName,
    platform: deviceName === 'm5stack_cores3' ? 'esp32/m5stack_cores3' : 'esp32:./host/platforms/m5stackchan_cores3',
    normalManifest,
    diagnosticManifest,
  }
}

function runFixture(fixture, command, manifestPath) {
  const result = spawnSync(
    process.execPath,
    [
      'scripts/firmware.mjs',
      command,
      fixture.deviceName,
      '--mode=instrument',
      '--manifest',
      path.relative(fixture.firmware, manifestPath),
    ],
    {
      cwd: fixture.firmware,
      encoding: 'utf8',
      env: {
        ...process.env,
        MODDABLE: fixture.fakeModdable,
        PATH: `${fixture.fakeBin}${path.delimiter}${process.env.PATH}`,
        STACKCHAN_BUILD_MODE: '',
        STACKCHAN_DRY_RUN: '',
        STACKCHAN_TEST_COMMAND_LOG: fixture.commandLog,
        npm_config_target: '',
      },
    },
  )
  assert.equal(result.status, 0, `${command}: ${result.stderr}`)
  return result
}

function readInvocations(commandLog) {
  return readFileSync(commandLog, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function assertCommandPair(invocations, command, manifestPath, platform) {
  assert.equal(invocations.length, 2)
  const [clean, main] = invocations
  assert.equal(clean[clean.indexOf('-p') + 1], platform)
  assert.equal(clean[clean.indexOf('-t') + 1], 'clean')
  assert.equal(clean.at(-1), manifestPath)
  assertMainCommand(main, command, manifestPath, platform)
}

function assertMainCommand(invocation, command, manifestPath, platform) {
  assert.equal(invocation[invocation.indexOf('-p') + 1], platform)
  assert.equal(invocation.at(-1), manifestPath)
  if (command === 'build' || command === 'deploy') {
    assert.equal(invocation[invocation.indexOf('-t') + 1], command)
  } else {
    assert.equal(invocation.includes('-t'), false)
  }
}

function count(source, value) {
  return source.split(value).length - 1
}
