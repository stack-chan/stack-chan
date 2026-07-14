#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { aliases, devices, resolveDevice } from './lib/devices.mjs'
import { prepareM5StackChanCoreS3IdfDependencies } from './lib/idf-dependencies.mjs'

const command = process.argv[2]
const rawArgs = process.argv.slice(3)
const targetOption = readOption(rawArgs, 'target')

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
const platform = `esp32:${device.platform}`
const manifest = readOption(rawArgs, 'manifest') ?? process.env.STACKCHAN_MANIFEST ?? device.manifest
const dryRun = process.env.STACKCHAN_DRY_RUN === '1'
const { mode: buildMode, args: buildModeArgs } = readBuildConfiguration(rawArgs)

if (!dryRun && deviceName === 'm5stackchan_cores3' && command !== 'mod') {
  try {
    prepareM5StackChanCoreS3IdfDependencies({ moddableDirectory: process.env.MODDABLE, mode: buildMode })
  } catch (error) {
    console.error(`[stack-chan] IDF dependencies could not be prepared: ${error.message}`)
    process.exit(1)
  }
}

switch (command) {
  case 'build':
    run('mcconfig', [...buildModeArgs, '-m', '-p', platform, '-t', 'build', path.resolve(manifest), ...args])
    break
  case 'flash':
    run('mcconfig', [...buildModeArgs, '-m', '-p', platform, path.resolve(manifest), ...args])
    break
  case 'deploy':
    run('mcconfig', [...buildModeArgs, '-m', '-p', platform, '-t', 'deploy', path.resolve(manifest), ...args])
    break
  case 'debug':
    run('mcconfig', [...buildModeArgs, '-m', '-p', platform, path.resolve(manifest), ...args])
    break
  case 'mod': {
    const modInput = args[0]
    if (!modInput) {
      console.error(
        '[stack-chan] MOD manifestを指定してください: npm run mod -- mods/examples/look_around/manifest.json',
      )
      process.exit(1)
    }
    const packageDirectory = findPackageDirectory(modInput)
    if (packageDirectory) {
      run('mcpack', ['mcrun', '-d', '-m', '-p', platform, ...args.slice(1)], packageDirectory)
    } else {
      run('mcrun', ['-d', '-m', '-p', platform, modInput, ...args.slice(1)])
    }
    break
  }
  default:
    console.error(`[stack-chan] Unknown command: ${command}`)
    printHelp()
    process.exit(1)
}

function run(bin, binArgs, cwd = process.cwd()) {
  console.log(`[stack-chan] ${command}: ${device.label}`)
  console.log(`[stack-chan] platform=${platform}`)
  if (command !== 'mod') console.log(`[stack-chan] manifest=${manifest}`)
  if (cwd !== process.cwd()) console.log(`[stack-chan] cwd=${cwd}`)
  if (dryRun) {
    console.log([bin, ...binArgs].join(' '))
    return
  }

  const result = spawnSync(bin, binArgs, { cwd, stdio: 'inherit' })
  if (result.error) {
    console.error(`[stack-chan] ${bin}を実行できませんでした: ${result.error.message}`)
    console.error('[stack-chan] npm run setup と npm run doctor を確認してください。')
    process.exit(1)
  }
  process.exit(result.status ?? 1)
}

function findPackageDirectory(value) {
  const resolved = path.resolve(value)
  if (!existsSync(resolved)) return null
  if (statSync(resolved).isDirectory()) {
    return existsSync(path.join(resolved, 'package.json')) ? resolved : null
  }
  if (path.basename(resolved) === 'package.json') return path.dirname(resolved)
  return null
}

function readOption(values, name) {
  const prefix = `--${name}=`
  const index = values.indexOf(`--${name}`)
  if (index >= 0) return values[index + 1]
  return values.find((value) => value.startsWith(prefix))?.slice(prefix.length)
}

/** Resolves the Moddable output mode and selector arguments for this invocation. */
function readBuildConfiguration(values) {
  const mode = readOption(values, 'mode') ?? process.env.STACKCHAN_BUILD_MODE
  if (mode) {
    if (mode === 'debug') return { mode, args: ['-d'] }
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

function firstDeviceArg(values) {
  return positionalArgs(values).find(isDeviceName) ?? 'm5stackchan_cores3'
}

function isDeviceName(value) {
  return Boolean(value && (devices[value] || aliases[value]))
}

/** Returns whether an argument selects a Moddable output mode. */
function isBuildModeFlag(value) {
  return value === '-i' || isDebugBuildFlag(value)
}

/** Returns whether an argument selects a debug build and debugger behavior. */
function isDebugBuildFlag(value) {
  return ['-d', '-dn', '-dx', '-dl'].includes(value)
}

function printHelp() {
  console.log(`Usage:
  npm run build
  npm run flash
  npm run debug
  npm run mod -- <mod-manifest>

Devices:
  m5stackchan_cores3  M5StackChan CoreS3 (default)
  stackchan_rt        Stack-chan RT CoreS3
  takao_core2_sg90    Stack-chan Takao Core2 + SG90

Examples:
  npm run flash:stackchan_rt
  npm run build:takao_core2_sg90
  npm run build:m5stackchan_cores3 -- --mode=release
  npm run build:m5stackchan_cores3 -- --mode=instrument
  STACKCHAN_DEVICE=takao_core2_sg90 npm run mod -- mods/examples/look_around/manifest.json`)
}
