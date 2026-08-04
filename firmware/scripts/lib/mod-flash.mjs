import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  findAppPartition,
  findXsPartition,
  parseEspAppDescriptor,
  parsePartitionTable,
  xsArchiveByteLength,
} from '../../../web/editor/esptool-installer.mjs'
import { xsArchiveVersion } from '../../../web/editor/mod-builder.mjs'
import { buildOutputDirectory } from './build-output.mjs'

export const partitionTableOffset = 0x8000
export const partitionTableSize = 0xc00
export const espAppHeaderSize = 0x100
export const moddableEspAppProjectName = 'xs_esp32'

/**
 * Resolves the archive path emitted by mcrun for one MOD project.
 * @param {{outputDirectory: string, mode: string, projectName: string}} options - Build output details.
 * @returns {string} Absolute path to the expected XS archive.
 */
export function resolveModArchivePath({ outputDirectory, mode, projectName }) {
  if (!outputDirectory) throw new Error('MOD output directory is required')
  if (!/^[^/\\]+$/.test(projectName)) throw new Error(`Invalid MOD project name: ${projectName || 'missing'}`)
  const outputMode = {
    debug: 'debug',
    instrument: 'instrument',
    release: 'release',
  }[mode]
  if (!outputMode) throw new Error(`Unsupported MOD build mode: ${mode || 'missing'}`)
  return path.join(outputDirectory, 'bin', 'esp32', outputMode, projectName, `${projectName}.xsa`)
}

/**
 * Validates and installs a built XS archive into the live device's xs
 * partition. The partition offset is discovered from the device rather than
 * inferred from the selected build target.
 * @param {{
 *   archivePath: string,
 *   port?: string,
 *   baud?: string|number,
 *   chip?: string,
 *   expectedProjectName?: string,
 *   expectedFirmwareVersion?: string,
 *   temporaryDirectory?: string,
 *   runCommand?: typeof executeCommand,
 * }} options - Device installation inputs.
 * @returns {{
 *   archivePath: string,
 *   archiveSize: number,
 *   archiveVersion: number[],
 *   partition: {offset: number, size: number},
 *   firmware: {version: string, moddableVersion: string, hostApiVersion: number, projectName: string},
 * }} Installed archive and device details.
 */
export function installModArchive({
  archivePath,
  port,
  baud,
  chip,
  expectedProjectName = moddableEspAppProjectName,
  expectedFirmwareVersion,
  temporaryDirectory = path.join(buildOutputDirectory, 'tmp'),
  runCommand = executeCommand,
}) {
  const archive = readFileSync(archivePath)
  const archiveSize = statSync(archivePath).size
  const declaredSize = xsArchiveByteLength(archive)
  if (declaredSize !== archiveSize) {
    throw new Error(
      `Invalid XS archive header or size: ${archivePath} (${declaredSize ?? 'missing'} != ${archiveSize})`,
    )
  }
  const archiveVersion = xsArchiveVersion(archive)
  if (!archiveVersion) throw new Error(`XS archive version is missing: ${archivePath}`)

  mkdirSync(temporaryDirectory, { recursive: true })
  const workDirectory = mkdtempSync(path.join(temporaryDirectory, 'stackchan-mod-flash-'))
  const partitionTablePath = path.join(workDirectory, 'partition-table.bin')
  const appHeaderPath = path.join(workDirectory, 'app-header.bin')
  const connectionArgs = esptoolConnectionArguments({ chip, port, baud })

  try {
    const { partition, appPartition } = readModPartitionLayout({
      connectionArgs,
      partitionTablePath,
      runCommand,
    })
    if (archiveSize > partition.size) {
      throw new Error(`MOD archive exceeds xs partition: ${archiveSize} > ${partition.size}`)
    }

    const firmware = readAndValidateFirmware({
      appPartition,
      appHeaderPath,
      connectionArgs,
      expectedProjectName,
      expectedFirmwareVersion,
      runCommand,
    })

    console.log(
      `[stack-chan] MOD preflight: ${firmware.projectName} ${firmware.version}, ` +
        `XS ${archiveVersion.join('.')}, xs=${hex(partition.offset)}/${partition.size}`,
    )
    runCommand('esptool', [
      ...connectionArgs,
      '--after',
      'hard-reset',
      'write-flash',
      '--flash-size',
      'keep',
      '--flash-mode',
      'keep',
      '--flash-freq',
      'keep',
      hex(partition.offset),
      archivePath,
    ])
    runCommand('esptool', [
      ...connectionArgs,
      '--after',
      'hard-reset',
      'verify-flash',
      hex(partition.offset),
      archivePath,
    ])
    console.log(`[stack-chan] MOD installed and verified: ${archivePath}`)

    return { archivePath, archiveSize, archiveVersion, partition, firmware }
  } finally {
    rmSync(workDirectory, { recursive: true, force: true })
  }
}

/**
 * Erases and verifies the live device's complete xs partition. The partition
 * offset and size are discovered from the device rather than selected by a
 * build target.
 * @param {{
 *   port?: string,
 *   baud?: string|number,
 *   chip?: string,
 *   expectedProjectName?: string,
 *   temporaryDirectory?: string,
 *   runCommand?: typeof executeCommand,
 * }} options - Device erase inputs.
 * @returns {{
 *   partition: {offset: number, size: number},
 *   firmware: {version: string, moddableVersion: string, hostApiVersion: number, projectName: string},
 *   verified: true,
 * }} Erased partition and device details.
 */
export function eraseModPartition({
  port,
  baud,
  chip,
  expectedProjectName = moddableEspAppProjectName,
  temporaryDirectory = path.join(buildOutputDirectory, 'tmp'),
  runCommand = executeCommand,
} = {}) {
  mkdirSync(temporaryDirectory, { recursive: true })
  const workDirectory = mkdtempSync(path.join(temporaryDirectory, 'stackchan-mod-erase-'))
  const partitionTablePath = path.join(workDirectory, 'partition-table.bin')
  const appHeaderPath = path.join(workDirectory, 'app-header.bin')
  const erasedPartitionPath = path.join(workDirectory, 'erased-xs.bin')
  const connectionArgs = esptoolConnectionArguments({ chip, port, baud })

  try {
    const { partition, appPartition } = readModPartitionLayout({
      connectionArgs,
      partitionTablePath,
      runCommand,
    })
    const firmware = readAndValidateFirmware({
      appPartition,
      appHeaderPath,
      connectionArgs,
      expectedProjectName,
      runCommand,
    })

    console.log(
      `[stack-chan] MOD erase preflight: ${firmware.projectName} ${firmware.version}, ` +
        `xs=${hex(partition.offset)}/${partition.size}`,
    )
    runCommand('esptool', [
      ...connectionArgs,
      '--after',
      'hard-reset',
      'erase-region',
      hex(partition.offset),
      hex(partition.size),
    ])
    runCommand('esptool', [
      ...connectionArgs,
      '--after',
      'hard-reset',
      'read-flash',
      hex(partition.offset),
      hex(partition.size),
      erasedPartitionPath,
    ])

    const erasedPartition = readFileSync(erasedPartitionPath)
    if (erasedPartition.length !== partition.size) {
      throw new Error(`MOD erase verification size mismatch: ${erasedPartition.length} != ${partition.size}`)
    }
    const dirtyIndex = erasedPartition.findIndex((byte) => byte !== 0xff)
    if (dirtyIndex >= 0) {
      throw new Error(
        `MOD erase verification failed at ${hex(partition.offset + dirtyIndex)}: ` +
          `0x${erasedPartition[dirtyIndex].toString(16).padStart(2, '0')}`,
      )
    }
    console.log(`[stack-chan] MOD partition erased and verified: xs=${hex(partition.offset)}/${partition.size}`)

    return { partition, firmware, verified: true }
  } finally {
    rmSync(workDirectory, { recursive: true, force: true })
  }
}

/**
 * Reads the partition table and locates the xs and application partitions.
 */
function readModPartitionLayout({ connectionArgs, partitionTablePath, runCommand }) {
  runCommand('esptool', [
    ...connectionArgs,
    '--after',
    'hard-reset',
    'read-flash',
    hex(partitionTableOffset),
    hex(partitionTableSize),
    partitionTablePath,
  ])
  const partitions = parsePartitionTable(readFileSync(partitionTablePath))
  return {
    partition: findXsPartition(partitions),
    appPartition: findAppPartition(partitions),
  }
}

/**
 * Reads and validates the firmware descriptor from the selected app partition.
 */
function readAndValidateFirmware({
  appPartition,
  appHeaderPath,
  connectionArgs,
  expectedProjectName,
  expectedFirmwareVersion,
  runCommand,
}) {
  runCommand('esptool', [
    ...connectionArgs,
    '--after',
    'hard-reset',
    'read-flash',
    hex(appPartition.offset),
    hex(espAppHeaderSize),
    appHeaderPath,
  ])
  const firmware = parseEspAppDescriptor(readFileSync(appHeaderPath))
  if (!firmware?.version || !firmware.projectName) {
    throw new Error('Firmware app descriptor could not be read from the device')
  }
  if (firmware.projectName !== expectedProjectName) {
    throw new Error(`Unexpected firmware project: ${firmware.projectName} != ${expectedProjectName}`)
  }
  if (expectedFirmwareVersion && firmware.moddableVersion !== expectedFirmwareVersion) {
    throw new Error(`Incompatible Moddable version: ${firmware.moddableVersion} != ${expectedFirmwareVersion}`)
  }
  return firmware
}

/**
 * Builds global esptool connection arguments.
 * @param {{chip?: string, port?: string, baud?: string|number}} options - Optional connection selectors.
 * @returns {string[]} CLI arguments placed before the esptool command.
 */
export function esptoolConnectionArguments({ chip, port, baud } = {}) {
  const args = []
  if (chip) {
    if (!/^[a-z0-9_-]+$/i.test(chip)) throw new Error(`Invalid esptool chip: ${chip}`)
    args.push('--chip', chip)
  }
  if (port) args.push('--port', port)
  if (baud !== undefined) {
    const value = String(baud)
    if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`Invalid esptool baud rate: ${value}`)
    args.push('--baud', value)
  }
  return args
}

/**
 * Formats an address or size for esptool.
 * @param {number} value - Numeric value.
 * @returns {string} Lowercase hexadecimal CLI value.
 */
function hex(value) {
  return `0x${value.toString(16)}`
}

/**
 * Runs esptool and fails the device operation on spawn or command errors.
 * @param {string} command - Executable name.
 * @param {string[]} args - Command arguments.
 */
function executeCommand(command, args) {
  console.log(`[stack-chan] ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) throw new Error(`Failed to run ${command}: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status ?? 'unknown'}`)
}
