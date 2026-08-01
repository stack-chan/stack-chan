#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  assertNoCustomBuildOutput,
  buildOutputDirectory,
  ensureBuildOutputDirectory,
  hostApplicationName,
  moddableOutputArguments,
} from './lib/build-output.mjs'
import {
  buildVariantMarkerPath,
  readBuildVariant,
  resolveBuildVariant,
  writeBuildVariant,
} from './lib/build-variant.mjs'
import { aliases, devices, resolveDevice } from './lib/devices.mjs'
import { prepareCoreS3IdfDependencies } from './lib/idf-dependencies.mjs'
import { installModArchive, resolveModArchivePath } from './lib/mod-flash.mjs'
import { prepareCoreS3VersionSdkconfig, readModdableVersion } from './lib/moddable-version.mjs'

const command = process.argv[2]
const rawArgs = process.argv.slice(3)
const targetOption = readOption(rawArgs, 'target')

try {
  assertNoCustomBuildOutput(rawArgs)
} catch (error) {
  console.error(`[stack-chan] ${error.message}`)
  process.exit(1)
}

if (!command || command === 'help' || command === '--help' || command === '-h') {
  printHelp()
  process.exit(command ? 0 : 1)
}

if (targetOption) {
  console.error(`[stack-chan] --target is not supported by this command wrapper: ${targetOption}`)
  console.error('[stack-chan] Use a named script such as npm run flash:stackchan_rt or npm run flash:takao_core2_sg90.')
  process.exit(1)
}

// npm swallows `--target=...` into this env var instead of argv; without this
// guard the wrapper would silently fall back to the default device.
if (process.env.npm_config_target) {
  console.error(`[stack-chan] --target is not supported by this command wrapper: ${process.env.npm_config_target}`)
  console.error(
    '[stack-chan] Use a named script such as npm run build:m5stack, npm run build:m5stackchan_cores3, or npm run flash:takao_core2_sg90.',
  )
  process.exit(1)
}

const deviceName = resolveDevice(
  readOption(rawArgs, 'device') ?? process.env.STACKCHAN_DEVICE ?? firstDeviceArg(rawArgs),
)
const device = devices[deviceName]
const args = positionalArgs(rawArgs).filter((arg) => !isDeviceName(arg) && !isBuildModeFlag(arg))
const platform = device.platform.startsWith('.') ? `esp32:${device.platform}` : `esp32/${device.platform}`
const manifest = readOption(rawArgs, 'manifest') ?? process.env.STACKCHAN_MANIFEST ?? device.manifest
const dryRun = process.env.STACKCHAN_DRY_RUN === '1'
const { mode: buildMode, args: buildModeArgs } = readBuildConfiguration(rawArgs)
const outputArgs = moddableOutputArguments()
const uploadPort =
  readOption(rawArgs, 'port') ?? process.env.STACKCHAN_PORT ?? process.env.UPLOAD_PORT ?? process.env.ESPPORT
const uploadBaud = readOption(rawArgs, 'baud') ?? process.env.STACKCHAN_BAUD ?? process.env.ESPBAUD
let subprocessEnvironment = uploadPort ? { ...process.env, UPLOAD_PORT: uploadPort } : process.env

if (!dryRun && isCoreS3Device(deviceName) && command !== 'mod' && command !== 'mod:build') {
  try {
    prepareCoreS3IdfDependencies({
      outputDirectory: buildOutputDirectory,
      platformName: deviceName,
      applicationName: hostApplicationName,
      mode: buildMode,
    })
  } catch (error) {
    console.error(`[stack-chan] IDF dependencies could not be prepared: ${error.message}`)
    process.exit(1)
  }
  try {
    const versionSdkconfig = prepareCoreS3VersionSdkconfig({ platformName: deviceName })
    subprocessEnvironment = { ...subprocessEnvironment, SDKCONFIGPATH: versionSdkconfig.directory }
  } catch (error) {
    console.error(`[stack-chan] CoreS3 firmware version could not be prepared: ${error.message}`)
    process.exit(1)
  }
}

const buildVariantChanged =
  !dryRun && ['build', 'flash', 'deploy', 'debug'].includes(command) ? prepareBuildVariant() : false

if (buildVariantChanged && deviceName === 'm5stackchan_cores3') {
  try {
    prepareCoreS3IdfDependencies({
      outputDirectory: buildOutputDirectory,
      platformName: deviceName,
      applicationName: hostApplicationName,
      mode: buildMode,
    })
  } catch (error) {
    console.error(`[stack-chan] IDF dependencies could not be prepared after target clean: ${error.message}`)
    process.exit(1)
  }
}

switch (command) {
  case 'build':
    run('mcconfig', [
      ...buildModeArgs,
      '-m',
      '-p',
      platform,
      '-t',
      'build',
      ...outputArgs,
      path.resolve(manifest),
      ...args,
    ])
    break
  case 'flash':
    run('mcconfig', [...buildModeArgs, '-m', '-p', platform, ...outputArgs, path.resolve(manifest), ...args])
    break
  case 'deploy':
    run('mcconfig', [
      ...buildModeArgs,
      '-m',
      '-p',
      platform,
      '-t',
      'deploy',
      ...outputArgs,
      path.resolve(manifest),
      ...args,
    ])
    break
  case 'debug':
    run('mcconfig', [...buildModeArgs, '-m', '-p', platform, ...outputArgs, path.resolve(manifest), ...args])
    break
  case 'mod':
  case 'mod:build': {
    const modInput = args[0]
    if (!modInput) {
      console.error(
        '[stack-chan] MOD manifestを指定してください: npm run mod -- mods/examples/look_around/manifest.json',
      )
      process.exit(1)
    }
    const packageDirectory = findPackageDirectory(modInput)
    const projectDirectory = packageDirectory ?? path.dirname(path.resolve(modInput))
    const projectName = path.basename(projectDirectory)
    if (packageDirectory) {
      run(
        'mcpack',
        ['mcrun', ...buildModeArgs, '-m', '-p', platform, '-t', 'build', ...outputArgs, ...args.slice(1)],
        packageDirectory,
      )
    } else {
      run('mcrun', [...buildModeArgs, '-m', '-p', platform, '-t', 'build', ...outputArgs, modInput, ...args.slice(1)])
    }
    const archivePath = resolveModArchivePath({
      outputDirectory: buildOutputDirectory,
      mode: buildMode,
      projectName,
    })
    if (command === 'mod:build' || dryRun) {
      console.log(`[stack-chan] MOD archive=${archivePath}`)
      if (command === 'mod') {
        console.log('[stack-chan] esptool will discover the live xs partition, write the archive, and verify it')
      }
      break
    }
    try {
      installModArchive({
        archivePath,
        chip: device.esptoolChip,
        port: uploadPort,
        baud: uploadBaud,
        expectedFirmwareVersion: device.firmwareVersionSource === 'moddable' ? readModdableVersion() : undefined,
      })
    } catch (error) {
      console.error(`[stack-chan] MODを書き込めませんでした: ${error.message}`)
      process.exit(1)
    }
    break
  }
  default:
    console.error(`[stack-chan] Unknown command: ${command}`)
    printHelp()
    process.exit(1)
}

/**
 * Runs a firmware tool or prints the command during a dry run.
 * @param {string} bin - Executable name.
 * @param {string[]} binArgs - Command-line arguments.
 * @param {string} cwd - Working directory for the subprocess.
 */
function run(bin, binArgs, cwd = process.cwd()) {
  console.log(`[stack-chan] ${command}: ${device.label}`)
  console.log(`[stack-chan] platform=${platform}`)
  if (command !== 'mod') console.log(`[stack-chan] manifest=${manifest}`)
  console.log(`[stack-chan] output=${buildOutputDirectory}`)
  if (cwd !== process.cwd()) console.log(`[stack-chan] cwd=${cwd}`)
  if (dryRun) {
    console.log([bin, ...binArgs].join(' '))
    return
  }

  ensureBuildOutputDirectory()
  const result = spawnSync(bin, binArgs, { cwd, env: subprocessEnvironment, stdio: 'inherit' })
  if (result.error) {
    console.error(`[stack-chan] ${bin}を実行できませんでした: ${result.error.message}`)
    console.error('[stack-chan] npm run setup と npm run doctor を確認してください。')
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

/**
 * Cleans a shared Moddable target before switching its application manifest.
 * mcconfig otherwise may reuse generated resources and configuration from the
 * previous manifest because every host variant has the same application name.
 */
function prepareBuildVariant() {
  const markerPath = buildVariantMarkerPath({
    outputDirectory: buildOutputDirectory,
    deviceName,
    mode: buildMode,
    applicationName: hostApplicationName,
  })
  const selectedVariant = resolveBuildVariant(manifest)
  if (readBuildVariant(markerPath) === selectedVariant) return false

  console.log(`[stack-chan] cleaning target before manifest switch: ${manifest}`)
  ensureBuildOutputDirectory()
  const result = spawnSync(
    'mcconfig',
    [...buildModeArgs, '-m', '-p', platform, '-t', 'clean', ...outputArgs, selectedVariant],
    { env: subprocessEnvironment, stdio: 'inherit' },
  )
  if (result.error) {
    console.error(`[stack-chan] mcconfigを実行できませんでした: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
  writeBuildVariant(markerPath, selectedVariant)
  return true
}

/**
 * Finds the package directory represented by a path, if any.
 * @param {string} value - Package directory, package.json, or manifest path.
 * @returns {string|null} Resolved package directory.
 */
function findPackageDirectory(value) {
  const resolved = path.resolve(value)
  if (!existsSync(resolved)) return null
  if (statSync(resolved).isDirectory()) {
    return existsSync(path.join(resolved, 'package.json')) ? resolved : null
  }
  if (path.basename(resolved) === 'package.json') return path.dirname(resolved)
  return null
}

/**
 * Reads a long option supplied as either --name value or --name=value.
 * @param {string[]} values - Command-line arguments.
 * @param {string} name - Option name without leading dashes.
 * @returns {string|undefined} Option value.
 */
function readOption(values, name) {
  const prefix = `--${name}=`
  const index = values.indexOf(`--${name}`)
  if (index >= 0) return values[index + 1]
  return values.find((value) => value.startsWith(prefix))?.slice(prefix.length)
}

/**
 * Resolves the Moddable output mode and selector arguments for this invocation.
 * @param {string[]} values - Command-line arguments.
 * @returns {{mode: string, args: string[]}} Build directory mode and mcconfig selector arguments.
 */
function readBuildConfiguration(values) {
  const mode = readOption(values, 'mode') ?? process.env.STACKCHAN_BUILD_MODE
  if (mode) {
    if (mode === 'debug') return { mode, args: [values.find(isDebugBuildFlag) ?? '-d'] }
    if (mode === 'instrument') return { mode, args: ['-i'] }
    if (mode === 'release') return { mode, args: [] }
    console.error(`[stack-chan] Unsupported build mode: ${mode}`)
    console.error('[stack-chan] Use --mode=debug, --mode=instrument, or --mode=release.')
    process.exit(1)
  }
  const debugFlag = values.find(isDebugBuildFlag)
  if (debugFlag) return { mode: 'debug', args: [debugFlag] }
  if (values.includes('-i')) return { mode: 'instrument', args: ['-i'] }
  return { mode: 'debug', args: ['-d'] }
}

/**
 * Returns positional and short-form arguments while removing long options.
 * @param {string[]} values - Command-line arguments.
 * @returns {string[]} Remaining arguments.
 */
function positionalArgs(values) {
  const result = []
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value.startsWith('--')) {
      if (!value.includes('=')) index += 1
      continue
    }
    result.push(value)
  }
  return result
}

/**
 * Finds the first named device argument or selects the default device.
 * @param {string[]} values - Command-line arguments.
 * @returns {string} Resolved device name candidate.
 */
function firstDeviceArg(values) {
  return positionalArgs(values).find(isDeviceName) ?? 'm5stackchan_cores3'
}

/**
 * Tests whether a value names a supported device or alias.
 * @param {string} value - Candidate device name.
 * @returns {boolean} Whether the value is a known device name.
 */
function isDeviceName(value) {
  return Boolean(value && (devices[value] || aliases[value]))
}

/**
 * Tests whether an argument selects a Moddable output mode.
 * @param {string} value - Command-line argument.
 * @returns {boolean} Whether the argument selects a build mode.
 */
function isBuildModeFlag(value) {
  return value === '-i' || isDebugBuildFlag(value)
}

/**
 * Tests whether a named target uses the CoreS3 host and managed audio dependencies.
 * @param {string} value - Resolved device name.
 * @returns {boolean} Whether the target is a supported CoreS3 variant.
 */
function isCoreS3Device(value) {
  return value === 'm5stack_cores3' || value === 'm5stackchan_cores3'
}

/**
 * Tests whether an argument selects a debug build and debugger behavior.
 * @param {string} value - Command-line argument.
 * @returns {boolean} Whether the argument is a debug selector.
 */
function isDebugBuildFlag(value) {
  return ['-d', '-dn', '-dx', '-dl'].includes(value)
}

/**
 * Prints command usage and supported devices.
 */
function printHelp() {
  console.log(`Usage:
  npm run build
  npm run flash
  npm run debug
  npm run mod:build -- <mod-manifest>
  npm run mod -- <mod-manifest>

Devices:
  m5stack_cores3      M5Stack CoreS3
  m5stackchan_cores3  M5StackChan CoreS3 (default)
  stackchan_rt        Stack-chan RT CoreS3
  takao_core2_sg90    Stack-chan Takao Core2 + SG90

Examples:
  npm run flash:stackchan_rt
  npm run build:takao_core2_sg90
  npm run build:m5stackchan_cores3 -- --mode=release
  npm run build:m5stackchan_cores3 -- --mode=instrument
  npm run debug:xsdb -- --port /dev/ttyACM1
  npm run mod:build -- mods/examples/mini_app_sample/manifest.json --mode=release
  npm run mod -- mods/examples/look_around/manifest.json --port /dev/ttyACM1
  STACKCHAN_DEVICE=takao_core2_sg90 npm run mod -- mods/examples/look_around/manifest.json`)
}
