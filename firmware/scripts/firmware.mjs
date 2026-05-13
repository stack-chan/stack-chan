#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'

const projectPath = 'stackchan'

const devices = {
  m5stackchan: {
    target: 'esp32/m5stack_cores3',
    platform: 'platforms/m5stackchan_cores3',
    label: 'M5Stack版StackChan CoreS3',
  },
  basic: {
    target: 'esp32/m5stack',
    platform: 'platforms/stackchan_m5stack',
    label: 'M5Stack Basic/Gray/Fire',
  },
  core2: {
    target: 'esp32/m5stack_core2',
    platform: 'platforms/stackchan_m5stack_core2',
    label: 'M5Stack Core2',
  },
  cores3: {
    target: 'esp32/m5stack_cores3',
    platform: 'platforms/stackchan_m5stack_cores3',
    label: 'M5Stack CoreS3',
  },
}

const aliases = {
  default: 'm5stackchan',
  m5stack: 'basic',
  core: 'basic',
  m5stackchan_cores3: 'm5stackchan',
}

const command = process.argv[2]
const args = process.argv.slice(3)
const targetOption = readOption(args, 'target')
const manifestOption = readOption(args, 'manifest')
const explicitTarget = targetOption ?? process.env.STACKCHAN_TARGET ?? process.env.npm_config_target
const explicitManifest = manifestOption ?? process.env.STACKCHAN_MANIFEST

if (!command || command === 'help' || command === '--help' || command === '-h') {
  printHelp()
  process.exit(command ? 0 : 1)
}

const deviceName = resolveDevice(
  readOption(args, 'device') ??
    process.env.STACKCHAN_DEVICE ??
    firstPositionalDevice(args) ??
    deviceNameForTarget(explicitTarget) ??
    'm5stackchan',
)
const device = devices[deviceName]
if (explicitTarget && !explicitManifest && !deviceNameForTarget(explicitTarget)) {
  console.error(`[stack-chan] Unknown target: ${explicitTarget}`)
  console.error('[stack-chan] --target を直接指定する場合は --manifest も指定してください。')
  console.error('[stack-chan] 通常は npm run flash:core2 のような名前付きコマンドを使ってください。')
  process.exit(1)
}
const rest = positionalArgs(args).filter((arg) => !isDeviceAlias(arg))
const platformTarget = `esp32:${path.resolve(device.platform)}`

switch (command) {
  case 'build':
    if (shouldUseMcconfig()) {
      runMcconfig(['-d', '-m', '-p', explicitTarget ?? device.target, '-t', 'build', explicitManifest, ...rest])
    } else {
      runXsDev(['build', '--device', platformTarget, ...configArgs(rest), projectPath])
    }
    break
  case 'flash':
  case 'deploy':
    if (shouldUseMcconfig()) {
      runMcconfig(['-d', '-m', '-p', explicitTarget ?? device.target, '-t', 'deploy', explicitManifest, ...rest])
    } else {
      runXsDev(['build', '--deploy', '--device', platformTarget, ...configArgs(rest), projectPath])
    }
    break
  case 'debug':
    if (shouldUseMcconfig()) {
      runMcconfig(['-d', '-m', '-p', explicitTarget ?? device.target, explicitManifest, ...rest])
    } else {
      runXsDev(['run', '--log', '--device', platformTarget, ...configArgs(rest), projectPath])
    }
    break
  case 'mod': {
    const modInput = rest[0]
    if (!modInput) {
      console.error(
        'MODのmanifestまたはpackageディレクトリを指定してください: npm run mod -- mods/look_around/manifest.json',
      )
      process.exit(1)
    }
    const target = explicitTarget ?? platformTarget
    const packageDirectory = findPackageDirectory(modInput)
    if (packageDirectory) {
      run('mcpack', ['mcrun', '-d', '-m', '-p', target, ...rest.slice(1)], packageDirectory)
    } else {
      run('mcrun', ['-d', '-m', '-p', target, modInput, ...rest.slice(1)])
    }
    break
  }
  default:
    console.error(`Unknown command: ${command}`)
    printHelp()
    process.exit(1)
}

function shouldUseMcconfig() {
  return Boolean(explicitManifest)
}

function configArgs(values) {
  return values.flatMap((value) => (value.includes('=') ? ['--config', value] : [value]))
}

function runXsDev(xsDevArgs) {
  console.log(`[stack-chan] ${command}: ${device.label}`)
  console.log(`[stack-chan] device=${platformTarget}`)
  const result = spawnSync('xs-dev', xsDevArgs, { stdio: 'inherit' })
  if (result.error) {
    console.error(`[stack-chan] xs-dev を実行できませんでした: ${result.error.message}`)
    console.error('[stack-chan] npm run setup と npm run check を実行し、Moddable SDK の PATH を確認してください。')
    process.exit(1)
  }
  process.exit(result.status ?? 1)
}

function runMcconfig(mcconfigArgs) {
  console.log(`[stack-chan] ${command}: ${device.label}`)
  console.log(`[stack-chan] target=${explicitTarget ?? device.target}`)
  console.log(`[stack-chan] manifest=${explicitManifest}`)
  run('mcconfig', mcconfigArgs)
}

function run(bin, binArgs, cwd = process.cwd()) {
  if (bin !== 'mcconfig') {
    console.log(`[stack-chan] ${command}: ${device.label}`)
    console.log(`[stack-chan] target=${explicitTarget ?? platformTarget}`)
  }
  if (cwd !== process.cwd()) console.log(`[stack-chan] cwd=${cwd}`)

  const result = spawnSync(bin, binArgs, { cwd, stdio: 'inherit' })
  if (result.error) {
    console.error(`[stack-chan] ${bin} を実行できませんでした: ${result.error.message}`)
    console.error('[stack-chan] npm run setup と npm run check を実行し、Moddable SDK の PATH を確認してください。')
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

function firstPositionalDevice(values) {
  return positionalArgs(values).find(isDeviceAlias)
}

function isDeviceAlias(value) {
  return Boolean(value && (devices[value] || aliases[value]))
}

function deviceNameForTarget(value) {
  switch (value) {
    case devices.basic.target:
      return 'basic'
    case devices.core2.target:
      return 'core2'
    case devices.cores3.target:
      return 'cores3'
    default:
      return null
  }
}

function resolveDevice(value) {
  const name = aliases[value] ?? value
  if (devices[name]) return name
  console.error(`Unknown device: ${value}`)
  console.error(`Supported devices: ${Object.keys(devices).join(', ')}`)
  process.exit(1)
}

function printHelp() {
  console.log(`Usage:
  npm run build              # 標準: M5Stack版StackChan CoreS3
  npm run flash              # ビルドして書き込み
  npm run debug              # ターミナルにログを出して起動
  npm run mod -- <manifest>  # MODを書き込み
  npm run mod -- <package-dir>  # package.json形式のMODを書き込み(mcpack)

Devices:
  m5stackchan  M5Stack版StackChan CoreS3 (default)
  basic        M5Stack Basic/Gray/Fire
  core2        M5Stack Core2
  cores3       M5Stack CoreS3

Advanced:
  STACKCHAN_DEVICE=core2 npm run flash
  STACKCHAN_TARGET=esp32/m5stack_core2 STACKCHAN_MANIFEST=stackchan/manifest_local.json npm run flash`)
}
