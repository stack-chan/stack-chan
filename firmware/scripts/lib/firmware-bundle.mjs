import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  buildOutputDirectory,
  firmwareDirectory,
  hostApplicationName,
  moddableOutputArguments,
} from './build-output.mjs'
import { prepareCoreS3IdfDependencies } from './idf-dependencies.mjs'
import { coreS3SdkconfigSourceDirectory, prepareVersionSdkconfig } from './moddable-version.mjs'

const appDirectory = path.join(firmwareDirectory, 'host', 'app')
const standardManifestPath = path.join(appDirectory, 'manifest.json')
const m5stackchanManifestPath = path.join(appDirectory, 'manifest_m5stackchan_cores3.json')

export const firmwareBundleName = 'tech.moddable.stackchan'
export const firmwareBundleSignature = firmwareBundleName.split('.').reverse().join('.')
export const firmwareBundleBinaries = ['bootloader.bin', 'partition-table.bin', 'xs_esp32.bin']
export const firmwareBundleTargetMetadataName = 'bundle-target.json'
export const firmwareBundleStagingDirectory = path.join(buildOutputDirectory, 'bundle-targets')

export const firmwareBundleTargets = [
  {
    name: 'm5stack',
    bundleId: 'com.m5stack',
    platform: 'esp32/m5stack',
    outputPlatform: 'm5stack',
    manifestPath: standardManifestPath,
    sdkconfigSource: ['build', 'devices', 'esp32', 'xsProj-esp32'],
    partitionSource: ['build', 'devices', 'esp32', 'xsProj-esp32', 'partitions.csv'],
  },
  {
    name: 'm5stack_core2',
    bundleId: 'com.m5stack.core2',
    platform: 'esp32/m5stack_core2',
    outputPlatform: 'm5stack_core2',
    manifestPath: standardManifestPath,
    sdkconfigSource: ['build', 'devices', 'esp32', 'targets', 'm5stack_core2', 'sdkconfig'],
    partitionSource: ['build', 'devices', 'esp32', 'targets', 'm5stack_core2', 'sdkconfig', 'partitions.csv'],
  },
  {
    name: 'm5stack_cores3',
    bundleId: 'com.m5stack.cores3',
    platform: 'esp32/m5stack_cores3',
    outputPlatform: 'm5stack_cores3',
    manifestPath: standardManifestPath,
    sdkconfigSource: ['build', 'devices', 'esp32', 'targets', 'm5stack_cores3', 'sdkconfig'],
    partitionSource: ['build', 'devices', 'esp32', 'targets', 'm5stack_cores3', 'sdkconfig', 'partitions.csv'],
    idfDependencyPlatform: 'm5stack_cores3',
  },
  {
    name: 'm5stackchan_cores3',
    bundleId: 'm5stackchan_cores3',
    platform: 'esp32:./host/platforms/m5stackchan_cores3',
    outputPlatform: 'm5stackchan_cores3',
    manifestPath: m5stackchanManifestPath,
    sdkconfigSource: coreS3SdkconfigSourceDirectory,
    partitionSource: ['build', 'devices', 'esp32', 'targets', 'm5stack_cores3', 'sdkconfig', 'partitions.csv'],
    idfDependencyPlatform: 'm5stackchan_cores3',
  },
]

/**
 * Resolves one supported bundle target.
 * @param {string} name - Matrix target name or final bundle directory name.
 * @returns {(typeof firmwareBundleTargets)[number]} Target configuration.
 */
export function resolveFirmwareBundleTarget(name) {
  const target = firmwareBundleTargets.find((candidate) => candidate.name === name || candidate.bundleId === name)
  if (!target) {
    throw new Error(
      `Unknown firmware bundle target: ${name || 'missing'} (expected ${firmwareBundleTargets
        .map((candidate) => candidate.name)
        .join(', ')})`,
    )
  }
  return target
}

/**
 * Removes all staged per-target bundle artifacts.
 * @param {string} stagingDirectory - Staging root to reset.
 * @returns {string} Recreated staging directory.
 */
export function resetFirmwareBundleStagingDirectory(stagingDirectory = firmwareBundleStagingDirectory) {
  rmSync(stagingDirectory, { recursive: true, force: true })
  mkdirSync(stagingDirectory, { recursive: true })
  return stagingDirectory
}

/**
 * Builds and validates one release firmware target for later bundle assembly.
 * @param {string} name - Supported matrix target name.
 * @param {{moddableDirectory?: string, outputDirectory?: string, runCommand?: typeof executeCommand}} options - Build inputs.
 * @returns {{target: (typeof firmwareBundleTargets)[number], directory: string, firmwareVersion: string}} Staged target details.
 */
export function buildFirmwareBundleTarget(
  name,
  {
    moddableDirectory = process.env.MODDABLE,
    outputDirectory = buildOutputDirectory,
    runCommand = executeCommand,
  } = {},
) {
  if (!moddableDirectory) throw new Error('MODDABLE environment variable is required')
  const target = resolveFirmwareBundleTarget(name)
  const sourceDirectory = Array.isArray(target.sdkconfigSource)
    ? path.join(moddableDirectory, ...target.sdkconfigSource)
    : target.sdkconfigSource
  const partitionSourcePath = Array.isArray(target.partitionSource)
    ? path.join(moddableDirectory, ...target.partitionSource)
    : target.partitionSource
  const versionSdkconfig = prepareVersionSdkconfig({
    platformName: target.outputPlatform,
    moddableDirectory,
    outputDirectory,
    sourceDirectory,
    partitionSourcePath,
  })

  if (target.idfDependencyPlatform) {
    prepareCoreS3IdfDependencies({
      outputDirectory,
      platformName: target.idfDependencyPlatform,
      applicationName: hostApplicationName,
      mode: 'release',
    })
  }

  mkdirSync(outputDirectory, { recursive: true })
  const bundleManifestPath = prepareBundleManifest(target, versionSdkconfig.directory, outputDirectory)
  try {
    runCommand(
      'mcconfig',
      [
        '-m',
        '-p',
        target.platform,
        '-s',
        firmwareBundleSignature,
        '-t',
        'build',
        ...moddableOutputArgumentsFor(outputDirectory),
        bundleManifestPath,
      ],
      firmwareDirectory,
      { ...process.env, MODDABLE: moddableDirectory },
    )
  } finally {
    rmSync(bundleManifestPath, { force: true })
  }

  const buildDirectory = path.join(
    outputDirectory,
    'bin',
    'esp32',
    target.outputPlatform,
    'release',
    hostApplicationName,
  )
  const stagingDirectory = path.join(outputDirectory, 'bundle-targets', target.bundleId)
  rmSync(stagingDirectory, { recursive: true, force: true })
  mkdirSync(stagingDirectory, { recursive: true })
  for (const binary of firmwareBundleBinaries) {
    const source = path.join(buildDirectory, binary)
    assertNonEmpty(source)
    cpSync(source, path.join(stagingDirectory, binary))
  }

  validateFirmwareBundleTarget(stagingDirectory, versionSdkconfig.version)
  writeFileSync(
    path.join(stagingDirectory, firmwareBundleTargetMetadataName),
    `${JSON.stringify(
      {
        format: 'tech.moddable.stackchan.bundle-target',
        formatVersion: 1,
        target: target.bundleId,
        firmwareVersion: versionSdkconfig.version,
      },
      null,
      2,
    )}\n`,
  )
  console.log(`[stack-chan] bundle target staged: ${target.bundleId} (${versionSdkconfig.version})`)
  return { target, directory: stagingDirectory, firmwareVersion: versionSdkconfig.version }
}

/**
 * Validates staged targets and assembles the web-flash directory without creating an archive.
 * @param {{inputDirectory?: string, outputDirectory?: string}} options - Assembly inputs.
 * @returns {{bundleDirectory: string, bundleZipPath: string, firmwareVersion: string}} Assembled bundle details.
 */
export function assembleFirmwareBundle({
  inputDirectory = firmwareBundleStagingDirectory,
  outputDirectory = appDirectory,
} = {}) {
  assertExactTargetSet(inputDirectory)
  const validatedTargets = firmwareBundleTargets.map((target) => {
    const directory = path.join(inputDirectory, target.bundleId)
    const metadata = readTargetMetadata(directory)
    if (metadata.target !== target.bundleId) {
      throw new Error(`Bundle target metadata mismatch: ${metadata.target} != ${target.bundleId}`)
    }
    validateFirmwareBundleTarget(directory, metadata.firmwareVersion)
    return { target, directory, firmwareVersion: metadata.firmwareVersion }
  })
  const firmwareVersions = new Set(validatedTargets.map(({ firmwareVersion }) => firmwareVersion))
  if (firmwareVersions.size !== 1) {
    throw new Error(`Bundle targets use different firmware versions: ${[...firmwareVersions].join(', ')}`)
  }

  const bundleDirectory = path.join(outputDirectory, firmwareBundleName)
  const bundleZipPath = path.join(outputDirectory, `${firmwareBundleName}.zip`)
  rmSync(bundleDirectory, { recursive: true, force: true })
  mkdirSync(bundleDirectory, { recursive: true })
  for (const { target, directory } of validatedTargets) {
    const targetDirectory = path.join(bundleDirectory, target.bundleId)
    mkdirSync(targetDirectory, { recursive: true })
    for (const binary of firmwareBundleBinaries) {
      cpSync(path.join(directory, binary), path.join(targetDirectory, binary))
    }
  }

  const firmwareVersion = validatedTargets[0].firmwareVersion
  console.log(`[stack-chan] firmware bundle assembled: ${firmwareBundleName} (${firmwareVersion})`)
  return { bundleDirectory, bundleZipPath, firmwareVersion }
}

/**
 * Assembles all staged targets and creates the distributable zip archive.
 * @param {{inputDirectory?: string, outputDirectory?: string, runCommand?: typeof executeCommand}} options - Packaging inputs.
 * @returns {{bundleDirectory: string, bundleZipPath: string, firmwareVersion: string}} Packaged bundle details.
 */
export function packageFirmwareBundle({
  inputDirectory = firmwareBundleStagingDirectory,
  outputDirectory = appDirectory,
  runCommand = executeCommand,
} = {}) {
  const result = assembleFirmwareBundle({ inputDirectory, outputDirectory })
  rmSync(result.bundleZipPath, { force: true })
  runCommand(
    'zip',
    ['-r', path.basename(result.bundleZipPath), path.basename(result.bundleDirectory)],
    outputDirectory,
    process.env,
  )
  assertNonEmpty(result.bundleZipPath)
  console.log(`[stack-chan] firmware bundle archive created: ${result.bundleZipPath}`)
  return result
}

/**
 * Validates binary presence, partition capacity, and embedded firmware version.
 * @param {string} directory - Directory containing one target's binaries.
 * @param {string} expectedVersion - Expected esp_app_desc version.
 * @returns {{firmwareSize: number, factorySize: number, firmwareVersion: string}} Validation details.
 */
export function validateFirmwareBundleTarget(directory, expectedVersion) {
  for (const binary of firmwareBundleBinaries) assertNonEmpty(path.join(directory, binary))
  const { firmwareSize, factorySize } = assertFitsFactoryPartition(directory)
  const firmwareVersion = readFirmwareVersion(path.join(directory, 'xs_esp32.bin'))
  if (firmwareVersion !== expectedVersion) {
    throw new Error(
      `Bundle firmware version mismatch: ${path.join(directory, 'xs_esp32.bin')} ` +
        `(${firmwareVersion || 'missing'} != ${expectedVersion})`,
    )
  }
  console.log(
    `[stack-chan] bundle target validated: ${path.basename(directory)} ` +
      `(${firmwareSize}/${factorySize} bytes, ${firmwareVersion})`,
  )
  return { firmwareSize, factorySize, firmwareVersion }
}

/**
 * Reads the ESP application version from a firmware image.
 * @param {string} firmwarePath - Path to xs_esp32.bin.
 * @returns {string} Embedded esp_app_desc version.
 */
export function readFirmwareVersion(firmwarePath) {
  const firmware = readFileSync(firmwarePath)
  const descriptorMagic = 0xabcd5432
  if (firmware.length < 0x70 || firmware.readUInt32LE(0x20) !== descriptorMagic) {
    throw new Error(`Firmware app descriptor is missing: ${firmwarePath}`)
  }
  const nul = firmware.indexOf(0, 0x30)
  const versionEnd = nul >= 0 && nul < 0x50 ? nul : 0x50
  return firmware.toString('utf8', 0x30, versionEnd).trim()
}

/**
 * Verifies that a target firmware image fits its factory app partition.
 * @param {string} directory - Directory containing target binaries.
 * @returns {{firmwareSize: number, factorySize: number}} Size validation details.
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
    throw new Error(`Factory app partition is missing: ${partitionTablePath}`)
  }

  const firmwareSize = statSync(firmwarePath).size
  if (firmwareSize > factorySize) {
    throw new Error(`Firmware exceeds factory app partition: ${firmwarePath} (${firmwareSize} > ${factorySize})`)
  }
  return { firmwareSize, factorySize }
}

/**
 * Reads and validates one staged target metadata file.
 * @param {string} directory - Staged target directory.
 * @returns {{format: string, formatVersion: number, target: string, firmwareVersion: string}} Metadata.
 */
function readTargetMetadata(directory) {
  const metadataPath = path.join(directory, firmwareBundleTargetMetadataName)
  let metadata
  try {
    metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
  } catch (error) {
    throw new Error(`Bundle target metadata could not be read: ${metadataPath} (${error.message})`)
  }
  if (metadata.format !== 'tech.moddable.stackchan.bundle-target' || metadata.formatVersion !== 1) {
    throw new Error(`Unsupported bundle target metadata: ${metadataPath}`)
  }
  if (typeof metadata.target !== 'string' || typeof metadata.firmwareVersion !== 'string') {
    throw new Error(`Invalid bundle target metadata: ${metadataPath}`)
  }
  return metadata
}

/**
 * Rejects missing, extra, and non-directory staging entries.
 * @param {string} inputDirectory - Staged target root.
 */
function assertExactTargetSet(inputDirectory) {
  const expected = firmwareBundleTargets.map(({ bundleId }) => bundleId).sort()
  let actual
  try {
    actual = readdirSync(inputDirectory, { withFileTypes: true })
  } catch (error) {
    throw new Error(`Bundle target directory could not be read: ${inputDirectory} (${error.message})`)
  }
  if (actual.some((entry) => !entry.isDirectory())) {
    throw new Error(`Bundle target root contains unexpected files: ${inputDirectory}`)
  }
  const actualNames = actual.map(({ name }) => name).sort()
  if (actualNames.length !== expected.length || actualNames.some((name, index) => name !== expected[index])) {
    throw new Error(`Bundle target set mismatch: ${actualNames.join(', ') || 'empty'} != ${expected.join(', ')}`)
  }
}

/**
 * Ensures a file exists and is not empty.
 * @param {string} filePath - File to inspect.
 */
function assertNonEmpty(filePath) {
  let size
  try {
    size = statSync(filePath).size
  } catch (error) {
    throw new Error(`Bundle binary is missing: ${filePath} (${error.message})`)
  }
  if (size === 0) throw new Error(`Bundle binary is empty: ${filePath}`)
}

/**
 * Uses the managed output directory unless a test supplies an isolated root.
 * @param {string} outputDirectory - Requested repository-local output root.
 * @returns {string[]} mcconfig output arguments.
 */
function moddableOutputArgumentsFor(outputDirectory) {
  return outputDirectory === buildOutputDirectory ? moddableOutputArguments() : ['-o', outputDirectory]
}

/**
 * Appends a generated sdkconfig override after the application manifest.
 *
 * Standard Moddable target manifests assign SDKCONFIGPATH unconditionally, so
 * a process environment value is overwritten while manifests are merged. A
 * final included manifest keeps the target configuration intact and supplies
 * the version overlay with normal manifest precedence.
 * @param {(typeof firmwareBundleTargets)[number]} target - Bundle target configuration.
 * @param {string} sdkconfigDirectory - Generated sdkconfig overlay directory.
 * @param {string} outputDirectory - Repository-local build output root.
 * @returns {string} Generated wrapper manifest path.
 */
function prepareBundleManifest(target, sdkconfigDirectory, outputDirectory) {
  const directory = path.join(outputDirectory, 'generated', 'bundle-manifests', target.name)
  const overrideManifestPath = path.join(directory, 'sdkconfig.json')
  const bundleManifestPath = path.join(
    path.dirname(target.manifestPath),
    `${firmwareBundleName}.${target.name}.${process.pid}.manifest.json`,
  )
  mkdirSync(directory, { recursive: true })
  writeFileSync(overrideManifestPath, `${JSON.stringify({ build: { SDKCONFIGPATH: sdkconfigDirectory } }, null, 2)}\n`)
  writeFileSync(
    bundleManifestPath,
    `${JSON.stringify({ include: [target.manifestPath, overrideManifestPath] }, null, 2)}\n`,
  )
  return bundleManifestPath
}

/**
 * Runs a bundle subprocess and throws on failure.
 * @param {string} command - Executable name.
 * @param {string[]} args - Command arguments.
 * @param {string} cwd - Working directory.
 * @param {NodeJS.ProcessEnv} env - Subprocess environment.
 */
function executeCommand(command, args, cwd, env) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' })
  if (result.error) throw new Error(`Failed to run ${command}: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status ?? 'unknown'}`)
}
