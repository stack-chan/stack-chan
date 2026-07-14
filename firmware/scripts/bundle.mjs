#!/usr/bin/env node

import { cpSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

if (!process.env.MODDABLE) {
  console.error('[stack-chan] MODDABLE environment variable is required')
  process.exit(1)
}

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
    m5stackchanManifestPath,
  ],
  firmwareDirectory,
)

const buildDirectory = path.join(
  process.env.MODDABLE,
  'build',
  'bin',
  'esp32',
  targetName,
  buildMode,
  'app',
)

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
}

rmSync(bundleZipPath, { force: true })
run('zip', ['-r', path.basename(bundleZipPath), bundleName], appDirectory)

console.log(`[stack-chan] bundle target added: ${targetName}`)

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

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.error) {
    console.error(`[stack-chan] failed to run ${command}: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}
