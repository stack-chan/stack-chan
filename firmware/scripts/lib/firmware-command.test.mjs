import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { webRtcComponents } from './webrtc-solution.mjs'

const firmwareDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const manifest = 'mods/examples/look_around/manifest.json'

function dryRun(...args) {
  return dryRunCommand('mod', ...args)
}

function dryRunCommand(command, ...args) {
  const commandArgs = command === 'mod' || command === 'mod:build' ? [manifest, ...args] : args
  const env = { ...process.env, STACKCHAN_BUILD_MODE: '', STACKCHAN_DRY_RUN: '1', npm_config_target: '' }
  delete env.STACKCHAN_DEVICE
  const result = spawnSync(process.execPath, ['scripts/firmware.mjs', command, ...commandArgs], {
    cwd: firmwareDirectory,
    encoding: 'utf8',
    env,
  })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout + result.stderr
}

test('host build, flash, and deploy commands default to release mode', () => {
  for (const command of ['build', 'flash', 'deploy']) {
    const output = dryRunCommand(command)
    assert.match(output, /mcconfig -m /)
    assert.doesNotMatch(output, /mcconfig -(?:d[nxl]?|i) /)
  }
})

test('debug commands keep debug as the default build mode', () => {
  assert.match(dryRunCommand('debug'), /mcconfig -d -m /)
})

test('host commands honor explicit non-release build modes', () => {
  for (const command of ['build', 'flash', 'deploy']) {
    for (const selector of ['--mode=debug', '-d']) {
      assert.match(dryRunCommand(command, selector), /mcconfig -d -m /)
    }
    for (const selector of ['--mode=instrument', '-i']) {
      assert.match(dryRunCommand(command, selector), /mcconfig -i -m /)
    }
  }
})

test('CoreS3 non-release host builds warn that Codex Voice USB is unavailable', () => {
  for (const command of ['build', 'flash', 'deploy', 'debug']) {
    for (const selector of ['--mode=debug', '--mode=instrument', '-d', '-i']) {
      assert.match(dryRunCommand(command, 'm5stackchan_cores3', selector), /Codex Voice USB is unavailable/)
    }
  }
  assert.doesNotMatch(dryRunCommand('build', 'm5stackchan_cores3'), /Codex Voice USB is unavailable/)
  assert.doesNotMatch(dryRunCommand('build', 'stackchan_rt', '--mode=debug'), /Codex Voice USB is unavailable/)
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

test('package MODs preserve case-sensitive board paths and clean aliases on success and failure', {
  skip: process.platform === 'win32',
}, () => {
  const fixture = createFirmwareWrapperFixture()
  try {
    const board = path.join(fixture.firmware, 'host/platforms/m5stackchan_cores3')
    const packageDirectory = path.join(fixture.root, 'ExternalPackage')
    mkdirSync(board, { recursive: true })
    mkdirSync(packageDirectory)
    writeFileSync(path.join(board, 'manifest.json'), '{}\n')
    writeFileSync(path.join(packageDirectory, 'package.json'), JSON.stringify({ name: '@stackchan/actual-output' }))
    const mcpack = path.join(fixture.fakeBin, 'mcpack')
    writeFileSync(
      mcpack,
      `#!/usr/bin/env node
const { appendFileSync, realpathSync } = require('node:fs')
const args = process.argv.slice(2)
const platform = args[args.indexOf('-p') + 1].toLowerCase()
const alias = platform.slice('esp32:'.length)
appendFileSync(process.env.STACKCHAN_TEST_COMMAND_LOG, JSON.stringify({ alias, board: realpathSync(alias), cwd: process.cwd() }) + '\\n')
process.exit(Number(process.env.STACKCHAN_TEST_MCPACK_STATUS))
`,
    )
    chmodSync(mcpack, 0o755)
    for (const status of [0, 23]) {
      const result = spawnSync(
        process.execPath,
        ['scripts/firmware.mjs', 'mod:build', packageDirectory, '--mode=release'],
        {
          cwd: fixture.firmware,
          encoding: 'utf8',
          env: {
            ...process.env,
            MODDABLE: fixture.fakeModdable,
            PATH: `${fixture.fakeBin}${path.delimiter}${process.env.PATH}`,
            STACKCHAN_DRY_RUN: '',
            STACKCHAN_TEST_COMMAND_LOG: fixture.commandLog,
            STACKCHAN_TEST_MCPACK_STATUS: String(status),
          },
        },
      )
      assert.equal(result.status, status, result.stderr)
      const invocation = readInvocations(fixture.commandLog).at(-1)
      assert.equal(invocation.board, realpathSync(board))
      assert.equal(invocation.cwd, realpathSync(packageDirectory))
      assert.equal(existsSync(path.dirname(invocation.alias)), false, 'temporary platform alias must be removed')
      if (status === 0) assert.match(result.stdout, /actual-output\/actual-output\.xsa/)
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('firmware wrapper prepares CoreS3 dependencies once before the requested command', () => {
  for (const command of ['build', 'flash', 'deploy', 'debug']) {
    const fixture = createFirmwareWrapperFixture()
    try {
      const result = runFixture(fixture, command, fixture.normalManifest)
      assert.equal(count(result.stdout, 'prepared IDF dependencies:'), 1)
      const invocations = readInvocations(fixture.commandLog)
      assert.equal(invocations.length, 1)
      assertMainCommand(invocations[0], command, fixture.normalManifest)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  }
})

test('RT release prepares both camera dependencies before the build', () => {
  const fixture = createFirmwareWrapperFixture('stackchan_rt', 'release')
  try {
    runFixture(fixture, 'build', fixture.normalManifest)
    const invocations = readInvocations(fixture.commandLog)
    assert.equal(invocations.length, 1)
    assert.equal(invocations[0][invocations[0].indexOf('-t') + 1], 'build')
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('build wrappers select WebRTC settings from the manifest, not an inherited source checkout', {
  skip: process.platform === 'win32',
}, () => {
  const fixture = createFirmwareWrapperFixture()
  try {
    const realtimeManifest = path.join(fixture.firmware, 'host/app/manifest_realtime.json')
    writeFileSync(realtimeManifest, JSON.stringify({ modules: { realtimeConversation: './conversation' } }))
    const fakeMcconfig = path.join(fixture.fakeBin, 'mcconfig')
    writeFileSync(
      fakeMcconfig,
      `#!/usr/bin/env node
const { readFileSync, writeFileSync } = require('node:fs')
const path = require('node:path')
writeFileSync(process.env.STACKCHAN_TEST_COMMAND_LOG,
  readFileSync(path.join(process.env.SDKCONFIGPATH, 'sdkconfig.defaults')))
`,
    )
    const run = (manifestPath, checkout, runner) => {
      const env = {
        ...process.env,
        MODDABLE: fixture.fakeModdable,
        PATH: `${fixture.fakeBin}${path.delimiter}${process.env.PATH}`,
        STACKCHAN_TEST_COMMAND_LOG: fixture.commandLog,
      }
      delete env.ESP_WEBRTC_SOLUTION
      if (checkout) env.ESP_WEBRTC_SOLUTION = checkout
      const result = spawnSync(
        process.execPath,
        runner === 'firmware'
          ? ['scripts/firmware.mjs', 'build', '--mode=instrument', '--manifest', manifestPath]
          : [
              'scripts/run-mcconfig.mjs',
              '-i',
              '-p',
              'esp32:./host/platforms/m5stackchan_cores3',
              '-t',
              'build',
              manifestPath,
            ],
        { cwd: fixture.firmware, encoding: 'utf8', env },
      )
      assert.ifError(result.error)
      assert.equal(result.status, 0, result.stderr)
      return readFileSync(fixture.commandLog, 'utf8')
    }
    for (const runner of ['firmware', 'mcconfig']) {
      const standalone = run(fixture.normalManifest, undefined, runner)
      assert.equal(run(fixture.normalManifest, fixture.solutionDirectory, runner), standalone)
      const realtime = run(realtimeManifest, fixture.solutionDirectory, runner)
      assert.notEqual(realtime, standalone, 'an explicit WebRTC manifest must still enable its overlay')
      const values = new Map(realtime.split('\n').map((line) => line.split('=')))
      assert.equal(values.get('CONFIG_AUDIO_ENCODER_OPUS_SUPPORT'), 'y')
      assert.equal(values.get('CONFIG_AUDIO_DECODER_OPUS_SUPPORT'), 'y')
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('direct CoreS3 commands prepare selected dependencies in each target and mode', () => {
  for (const platform of ['esp32/m5stack_cores3', 'esp32:./host/platforms/m5stackchan_cores3']) {
    for (const mode of ['release', 'debug', 'instrument']) {
      for (const command of ['build', 'deploy']) {
        for (const realtime of [false, true]) {
          const fixture = createDirectRunnerFixture()
          try {
            runDirectFixture(fixture, { platform, mode, command, realtime })
            const invocations = readInvocations(fixture.commandLog)
            assert.equal(invocations.length, 1)
            const [args] = invocations
            assert.equal(args[args.indexOf('-t') + 1], command)
            assert.equal(args[args.indexOf('-p') + 1], platform)
            assert.equal(args[args.indexOf('-o') + 1], path.join(fixture.firmware, 'dist'))
          } finally {
            rmSync(fixture.root, { recursive: true, force: true })
          }
        }
      }
    }
  }
})

function createDirectRunnerFixture() {
  const fixture = createFirmwareWrapperFixture()
  fixture.realtimeManifest = path.join(fixture.firmware, 'host/app/manifest_realtime.json')
  writeFileSync(fixture.realtimeManifest, JSON.stringify({ modules: { realtimeConversation: './conversation' } }))
  writeFileSync(
    path.join(fixture.fakeBin, 'mcconfig'),
    `#!/usr/bin/env node
const assert = require('node:assert/strict')
const { appendFileSync, lstatSync, readFileSync, realpathSync } = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
appendFileSync(process.env.STACKCHAN_TEST_COMMAND_LOG, JSON.stringify(args) + '\\n')
const output = args[args.indexOf('-o') + 1]
const platform = args[args.indexOf('-p') + 1].split(/[/:\\\\]/).at(-1)
const mode = args.some(arg => ['-d', '-dn', '-dl', '-dx'].includes(arg)) ? 'debug' : args.includes('-i') ? 'instrument' : 'release'
const tmp = path.join(output, 'tmp/esp32', platform, mode, 'stack-chan-host')
const project = path.join(tmp, 'xsProj-esp32s3')
const manifestPath = args.find(arg => arg.endsWith('.json'))
const realtime = Boolean(JSON.parse(readFileSync(manifestPath, 'utf8')).modules?.realtimeConversation)
const idf = readFileSync(path.join(project, 'main/idf_component.yml'), 'utf8')
assert.ok(idf.includes('espressif/esp32-camera:'))
const baseline = ['espressif/esp32-camera', ...(platform === 'm5stackchan_cores3' ? ['espressif/esp_audio_codec'] : [])]
const conversation = JSON.parse(readFileSync(path.join(process.cwd(), 'host/modules/realtime-conversation/esp32/manifest.json'), 'utf8'))
const expected = new Set([...baseline, ...(realtime ? conversation.dependencies.filter(dep => dep.name).map(dep => 'espressif/' + dep.name) : [])])
const actual = new Set([...idf.matchAll(/^  (espressif\\/[^:]+):/gm)].map(match => match[1]))
assert.deepEqual(actual, expected, 'stale IDF dependencies')
for (const name of ${JSON.stringify(webRtcComponents)}) {
  const link = path.join(project, 'components', name)
  if (realtime) assert.equal(realpathSync(link), realpathSync(path.join(process.env.ESP_WEBRTC_SOLUTION, 'components', name)))
  else assert.equal(lstatSync(link, { throwIfNoEntry: false }), undefined, 'stale component link')
}

`,
  )
  return fixture
}

function runDirectFixture(
  fixture,
  {
    platform = 'esp32:./host/platforms/m5stackchan_cores3',
    mode = 'release',
    command = 'build',
    realtime,
    expectedStatus = 0,
  },
) {
  const result = spawnSync(
    process.execPath,
    [
      'scripts/run-mcconfig.mjs',
      ...(mode === 'debug' ? ['-dn'] : mode === 'instrument' ? ['-i'] : []),
      '-m',
      '-p',
      platform,
      '-t',
      command,
      realtime ? fixture.realtimeManifest : fixture.normalManifest,
    ],
    {
      cwd: fixture.firmware,
      encoding: 'utf8',
      env: {
        ...process.env,
        MODDABLE: fixture.fakeModdable,
        ESP_WEBRTC_SOLUTION: fixture.solutionDirectory,
        PATH: `${fixture.fakeBin}${path.delimiter}${process.env.PATH}`,
        STACKCHAN_TEST_COMMAND_LOG: fixture.commandLog,
      },
    },
  )
  assert.ifError(result.error)
  assert.equal(result.status, expectedStatus, result.stderr)
  return result
}

/** Create an isolated firmware tree and fake toolchain for command-wrapper tests. */
function createFirmwareWrapperFixture(deviceName = 'm5stackchan_cores3', mode = 'instrument') {
  const root = mkdtempSync(path.join(tmpdir(), 'stackchan-firmware-wrapper-Case-'))
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
  const conversationDirectory = path.join(fixtureFirmware, 'host/modules/realtime-conversation/esp32')
  mkdirSync(conversationDirectory, { recursive: true })
  cpSync(
    path.join(firmwareDirectory, 'host/modules/realtime-conversation/esp32/manifest.json'),
    path.join(conversationDirectory, 'manifest.json'),
  )
  const solutionDirectory = path.join(root, 'webrtc-solution')
  for (const component of webRtcComponents) {
    const directory = path.join(solutionDirectory, 'components', component)
    mkdirSync(directory, { recursive: true })
    writeFileSync(path.join(directory, 'CMakeLists.txt'), '# local test component\n')
  }
  mkdirSync(fixtureWebEditor, { recursive: true })
  cpSync(
    path.resolve(firmwareDirectory, '../web/editor/esptool-installer.mjs'),
    path.join(fixtureWebEditor, 'esptool-installer.mjs'),
  )
  cpSync(
    path.resolve(firmwareDirectory, '../web/editor/mod-builder.mjs'),
    path.join(fixtureWebEditor, 'mod-builder.mjs'),
  )

  cpSync(
    path.resolve(firmwareDirectory, '../web/editor/xs-compatibility.mjs'),
    path.join(fixtureWebEditor, 'xs-compatibility.mjs'),
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
  writeFileSync(path.join(partitionDirectory, 'sdkconfig.defaults'), '')

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
  writeFileSync(
    fakeMcconfig,
    `#!/usr/bin/env node
const { appendFileSync, existsSync, readFileSync } = require('node:fs')
const path = require('node:path')

const args = process.argv.slice(2)
appendFileSync(process.env.STACKCHAN_TEST_COMMAND_LOG, JSON.stringify(args) + '\\n')
const outputIndex = args.indexOf('-o')
const outputDirectory = args[outputIndex + 1]
const idfManifest = path.join(
  outputDirectory,
  'tmp',
  'esp32',
  ${JSON.stringify(deviceName)},
  ${JSON.stringify(mode)},
  'stack-chan-host',
  'xsProj-esp32s3',
  'main',
  'idf_component.yml',
)
if (
  !existsSync(idfManifest) ||
  !${JSON.stringify(deviceName === 'stackchan_rt' ? ['esp32-camera', 'esp_jpeg'] : ['esp_audio_codec'])}.every(
    (name) => readFileSync(idfManifest, 'utf8').includes('espressif/' + name + ':'),
  )
) {
  process.exit(12)
} else if (${JSON.stringify(deviceName)} === 'stackchan_rt') {
  // Stop at the compiler boundary; no release binaries are produced by this mock.
  process.exit(17)
}
`,
  )
  chmodSync(fakeMcconfig, 0o755)

  return {
    root,
    firmware: fixtureFirmware,
    fakeBin,
    fakeModdable,
    solutionDirectory,
    commandLog,
    normalManifest,
    diagnosticManifest,
    deviceName,
    mode,
  }
}

function runFixture(fixture, command, manifestPath) {
  const result = spawnSync(
    process.execPath,
    [
      'scripts/firmware.mjs',
      command,
      fixture.deviceName,
      `--mode=${fixture.mode}`,
      '--manifest',
      path.relative(fixture.firmware, manifestPath),
    ],
    {
      cwd: fixture.firmware,
      encoding: 'utf8',
      env: {
        ...process.env,
        MODDABLE: fixture.fakeModdable,
        ESP_WEBRTC_SOLUTION: fixture.solutionDirectory,
        PATH: `${fixture.fakeBin}${path.delimiter}${process.env.PATH}`,
        STACKCHAN_BUILD_MODE: '',
        STACKCHAN_DRY_RUN: '',
        STACKCHAN_TEST_COMMAND_LOG: fixture.commandLog,
        npm_config_target: '',
      },
    },
  )
  assert.ifError(result.error)
  assert.equal(result.status, fixture.deviceName === 'stackchan_rt' ? 17 : 0, `${command}: ${result.stderr}`)
  return result
}

function readInvocations(commandLog) {
  return readFileSync(commandLog, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function assertMainCommand(invocation, command, manifestPath) {
  assert.equal(invocation[invocation.indexOf('-p') + 1], 'esp32:./host/platforms/m5stackchan_cores3')
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

test('sanoTTS selects board-derived timings without changing standard or Opus capability settings', () => {
  const fixture = createFirmwareWrapperFixture()
  try {
    const sdkconfig = path.join(
      fixture.fakeModdable,
      'build/devices/esp32/targets/m5stack_cores3/sdkconfig/sdkconfig.defaults',
    )
    writeFileSync(
      sdkconfig,
      [
        'CONFIG_SPIRAM_SPEED_40M=y',
        'CONFIG_SPIRAM_SPEED_80M=n',
        'CONFIG_ESPTOOLPY_FLASHMODE_DIO=y',
        'CONFIG_AUDIO_DECODER_AAC_SUPPORT=y',
        'CONFIG_AUDIO_ENCODER_OPUS_SUPPORT=n',
        'CONFIG_AUDIO_DECODER_OPUS_SUPPORT=n',
        'CONFIG_CAMERA_DMA_BUFFER_SIZE_MAX=32768',
        '',
      ].join('\n'),
    )
    const manifest = path.join(fixture.firmware, 'host/app/manifest_sanotts.json')
    writeFileSync(manifest, JSON.stringify({ modules: { realtimeConversation: './conversation' } }))
    writeFileSync(
      path.join(fixture.fakeBin, 'mcconfig'),
      `#!/usr/bin/env node
const {readFileSync,writeFileSync}=require('node:fs')
const path=require('node:path')
writeFileSync(process.env.STACKCHAN_TEST_COMMAND_LOG,readFileSync(path.join(process.env.SDKCONFIGPATH,'sdkconfig.defaults')))
`,
    )
    const run = (input) => {
      const result = spawnSync(
        process.execPath,
        ['scripts/firmware.mjs', 'build', '--mode=instrument', '--manifest', input],
        {
          cwd: fixture.firmware,
          encoding: 'utf8',
          env: {
            ...process.env,
            MODDABLE: fixture.fakeModdable,
            ESP_WEBRTC_SOLUTION: fixture.solutionDirectory,
            PATH: `${fixture.fakeBin}${path.delimiter}${process.env.PATH}`,
            STACKCHAN_TEST_COMMAND_LOG: fixture.commandLog,
          },
        },
      )
      assert.equal(result.status, 0, result.stderr)
      return readFileSync(fixture.commandLog, 'utf8')
    }
    const standard = run(fixture.normalManifest)
    assert.match(standard, /^CONFIG_SPIRAM_SPEED_40M=y$/m)
    assert.match(standard, /^CONFIG_ESPTOOLPY_FLASHMODE_DIO=y$/m)
    const optional = run(manifest)
    assert.doesNotMatch(optional, /^CONFIG_(SPIRAM_SPEED_(?:40M|80M)|ESPTOOLPY_FLASHMODE_(?:DIO|QIO))=/m)
    assert.match(optional, /^CONFIG_AUDIO_DECODER_AAC_SUPPORT=y$/m)
    assert.match(optional, /^CONFIG_CAMERA_DMA_BUFFER_SIZE_MAX=32768$/m)
    assert.match(optional, /^CONFIG_AUDIO_ENCODER_OPUS_SUPPORT=y$/m)
    assert.match(optional, /^CONFIG_AUDIO_DECODER_OPUS_SUPPORT=y$/m)
    assert.equal(run(fixture.normalManifest), standard)
    const feature = JSON.parse(
      readFileSync(path.join(firmwareDirectory, 'host/modules/audio/sanotts-jp/manifest.json'), 'utf8'),
    )
    assert.equal(feature.platforms['esp32/m5stackchan_cores3'].build, undefined)
    const host = JSON.parse(readFileSync(path.join(firmwareDirectory, 'host/app/manifest_sanotts.json'), 'utf8'))
    assert.equal(host.include.at(-1), './manifest_sanotts_profile.json')
    const profilePath = path.join(firmwareDirectory, 'host/app/manifest_sanotts_profile.json')
    const profile = JSON.parse(readFileSync(profilePath, 'utf8'))
    assert.equal(profile.build.NAME, 'stack-chan-sanotts')
    assert.equal(
      path.resolve(path.dirname(profilePath), profile.build.SDKCONFIGPATH),
      path.join(firmwareDirectory, 'dist/generated/sdkconfig/m5stackchan_cores3'),
    )
    assert.equal(profile.esp32Config.CONFIG_SPIRAM_SPEED_80M, 'y')
    assert.equal(profile.esp32Config.CONFIG_ESPTOOLPY_FLASHMODE_QIO, 'y')
    assert.equal(profile.esp32Config.CONFIG_ESP32S3_DATA_CACHE_64KB, 'y')
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})
