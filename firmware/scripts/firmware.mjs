#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'

const devices = {
  m5stackchan_cores3: {
    platform: './host/platforms/m5stackchan_cores3',
    manifest: './host/app/manifest_m5stackchan_cores3.json',
    label: 'M5StackChan CoreS3',
  },
  stackchan_rt: {
    platform: './host/platforms/stackchan_rt',
    manifest: './host/app/manifest_stackchan_rt.json',
    label: 'Stack-chan RT CoreS3',
  },
  takao_core2_sg90: {
    platform: './host/platforms/takao_core2_sg90',
    manifest: './host/app/manifest_takao_core2_sg90.json',
    label: 'Stack-chan Takao Core2 + SG90',
  },
}

const aliases = {
  default: 'm5stackchan_cores3',
  m5stackchan: 'm5stackchan_cores3',
  rt: 'stackchan_rt',
  takao: 'takao_core2_sg90',
}

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

const deviceName = resolveDevice(
  readOption(rawArgs, 'device') ?? process.env.STACKCHAN_DEVICE ?? firstDeviceArg(rawArgs),
)
const device = devices[deviceName]
const args = positionalArgs(rawArgs).filter((arg) => !isDeviceName(arg))
const platform = `esp32:${device.platform}`
const manifest = readOption(rawArgs, 'manifest') ?? process.env.STACKCHAN_MANIFEST ?? device.manifest
const dryRun = process.env.STACKCHAN_DRY_RUN === '1'

switch (command) {
  case 'build':
    run('mcconfig', ['-d', '-m', '-p', platform, '-t', 'build', path.resolve(manifest), ...args])
    break
  case 'flash':
    run('mcconfig', ['-d', '-m', '-p', platform, path.resolve(manifest), ...args])
    break
  case 'deploy':
    run('mcconfig', ['-d', '-m', '-p', platform, '-t', 'deploy', path.resolve(manifest), ...args])
    break
  case 'debug':
    run('mcconfig', ['-d', '-m', '-p', platform, path.resolve(manifest), ...args])
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

function resolveDevice(value) {
  const name = aliases[value] ?? value
  if (devices[name]) return name
  console.error(`[stack-chan] Unknown device: ${value}`)
  console.error(`[stack-chan] Supported devices: ${Object.keys(devices).join(', ')}`)
  process.exit(1)
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
  STACKCHAN_DEVICE=takao_core2_sg90 npm run mod -- mods/examples/look_around/manifest.json`)
}
