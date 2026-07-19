#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildOutputDirectory,
  ensureBuildOutputDirectory,
  hostApplicationName,
  moddableOutputArguments,
} from './lib/build-output.mjs'
import { prepareCoreS3IdfDependencies } from './lib/idf-dependencies.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const firmwareDirectory = path.resolve(scriptsDirectory, '..')
const appDirectory = path.join(firmwareDirectory, 'host', 'app')
const manifestPath = path.join(appDirectory, 'manifest.json')
const m5stackchanManifestPath = path.join(appDirectory, 'manifest_m5stackchan_cores3.json')
const bundleName = 'tech.moddable.stackchan'
const bundleDirectory = path.join(appDirectory, bundleName)
const bundleZipPath = path.join(appDirectory, `${bundleName}.zip`)
const targetName = 'm5stackchan_cores3'
const targetDirectory = path.join(bundleDirectory, targetName)
const buildMode = 'release'
const signature = 'stackchan.moddable.tech'
const binaries = ['bootloader.bin', 'partition-table.bin', 'xs_esp32.bin']
const bundleTargets = ['com.m5stack', 'com.m5stack.core2', 'com.m5stack.cores3', targetName]
const requiredModdableVersion = '8.3.1'

if (!process.env.MODDABLE) {
  console.error('[stack-chan] MODDABLE environment variable is required')
  process.exit(1)
}
const moddableVersion = readFileSync(path.join(process.env.MODDABLE, 'tools', 'VERSION'), 'utf8').trim()
if (moddableVersion !== requiredModdableVersion) {
  console.error(
    `[stack-chan] Moddable SDK ${requiredModdableVersion} is required (found ${moddableVersion || 'missing'})`,
  )
  process.exit(1)
}

// mcbundle does not forward its -o option to the mcconfig processes it
// generates, so its standard device builds intentionally remain under the
// Moddable SDK. Seed the CoreS3 dependency manifest at that legacy location.
prepareCoreS3IdfDependencies({
  outputDirectory: path.join(process.env.MODDABLE, 'build'),
  platformName: 'm5stack_cores3',
  applicationName: hostApplicationName,
  mode: buildMode,
})
prepareCoreS3IdfDependencies({
  outputDirectory: buildOutputDirectory,
  platformName: targetName,
  applicationName: hostApplicationName,
  mode: buildMode,
})
ensureBuildOutputDirectory()
run('mcbundle', ['-m', manifestPath], appDirectory)
run(
  'mcconfig',
  [
    '-m',
    '-p',
    'esp32:./host/platforms/m5stackchan_cores3',
    '-s',
    signature,
    '-t',
    'build',
    ...moddableOutputArguments(),
    m5stackchanManifestPath,
  ],
  firmwareDirectory,
)

const buildDirectory = path.join(buildOutputDirectory, 'bin', 'esp32', targetName, buildMode, hostApplicationName)

mkdirSync(targetDirectory, { recursive: true })
for (const binary of binaries) {
  const source = path.join(buildDirectory, binary)
  const destination = path.join(targetDirectory, binary)
  assertNonEmpty(source)
  cpSync(source, destination)
  assertNonEmpty(destination)
}

for (const bundleTarget of bundleTargets) {
  const directory = path.join(bundleDirectory, bundleTarget)
  for (const binary of binaries) assertNonEmpty(path.join(directory, binary))
  assertFitsFactoryPartition(directory)
  assertFirmwareVersion(directory, moddableVersion)
}

rmSync(bundleZipPath, { force: true })
run('zip', ['-r', path.basename(bundleZipPath), bundleName], appDirectory)

console.log(`[stack-chan] bundle target added: ${targetName}`)

/**
 * Ensures a bundled firmware binary exists and is not empty.
 * @param {string} filePath - Path to the binary to validate.
 */
function assertNonEmpty(filePath) {
  let size
  try {
    size = statSync(filePath).size
  } catch (error) {
    console.error(`[stack-chan] bundle binary is missing: ${filePath}`)
    console.error(error.message)
    process.exit(1)
  }
  if (size === 0) {
    console.error(`[stack-chan] bundle binary is empty: ${filePath}`)
    process.exit(1)
  }
}

/**
 * Verifies that a target firmware image fits its factory app partition.
 * @param {string} directory - Directory containing the target binaries.
 */
function assertFitsFactoryPartition(directory) {
  const partitionTablePath = path.join(directory, 'partition-table.bin')
  const firmwarePath = path.join(directory, 'xs_esp32.bin')
  const partitionTable = readFileSync(partitionTablePath)
  let factorySize

  for (let offset = 0; offset + 32 <= partitionTable.length; offset += 32) {
    if (partitionTable.readUInt16LE(offset) !== 0x50aa) break
    const type = partitionTable.readUInt8(offset + 2)
    const subtype = partitionTable.readUInt8(offset + 3)
    if (type === 0 && subtype === 0) {
      factorySize = partitionTable.readUInt32LE(offset + 8)
      break
    }
  }

  if (factorySize === undefined) {
    console.error(`[stack-chan] factory app partition is missing: ${partitionTablePath}`)
    process.exit(1)
  }

  const firmwareSize = statSync(firmwarePath).size
  if (firmwareSize > factorySize) {
    console.error(
      `[stack-chan] firmware exceeds factory app partition: ${firmwarePath} (${firmwareSize} > ${factorySize})`,
    )
    process.exit(1)
  }

  console.log(
    `[stack-chan] bundle target fits factory partition: ${path.basename(directory)} (${firmwareSize}/${factorySize} bytes)`,
  )
}

/**
 * Ensures the ESP app descriptor exposes the Moddable SDK version used by the
 * editor's MOD compatibility preflight. ESP-IDF otherwise falls back to the
 * nearest repository's Git revision when builds use a repository-local output.
 * @param {string} directory - Directory containing xs_esp32.bin.
 * @param {string} expectedVersion - Moddable SDK version used for the build.
 */
function assertFirmwareVersion(directory, expectedVersion) {
  const firmwarePath = path.join(directory, 'xs_esp32.bin')
  const firmware = readFileSync(firmwarePath)
  const descriptorMagic = 0xabcd5432
  if (firmware.length < 0x70 || firmware.readUInt32LE(0x20) !== descriptorMagic) {
    console.error(`[stack-chan] firmware app descriptor is missing: ${firmwarePath}`)
    process.exit(1)
  }

  const nul = firmware.indexOf(0, 0x30)
  const versionEnd = nul >= 0 && nul < 0x50 ? nul : 0x50
  const actualVersion = firmware.toString('utf8', 0x30, versionEnd).trim()
  if (actualVersion !== expectedVersion) {
    console.error(
      `[stack-chan] firmware version mismatch: ${firmwarePath} (${actualVersion || 'missing'} != ${expectedVersion})`,
    )
    process.exit(1)
  }

  console.log(`[stack-chan] bundle target firmware version: ${path.basename(directory)} (${actualVersion})`)
}

/**
 * Runs a bundle subprocess and propagates failures to the caller.
 * @param {string} command - Executable name.
 * @param {string[]} args - Command-line arguments.
 * @param {string} cwd - Working directory for the subprocess.
 */
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.error) {
    console.error(`[stack-chan] failed to run ${command}: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}
