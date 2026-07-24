import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  findAppPartition,
  findXsPartition,
  parseEspAppDescriptor,
  parsePartitionTable,
  xsArchiveByteLength,
} from '../../../web/editor/esptool-installer.mjs'
import { xsArchiveVersion } from '../../../web/editor/mod-builder.mjs'

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
  const outputMode = mode === 'debug' ? 'debug' : 'release'
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
 *   firmware: {version: string, projectName: string},
 * }} Installed archive and device details.
 */
export function installModArchive({
  archivePath,
  port,
  baud,
  chip,
  expectedProjectName = moddableEspAppProjectName,
  expectedFirmwareVersion,
  temporaryDirectory = tmpdir(),
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

  const workDirectory = mkdtempSync(path.join(temporaryDirectory, 'stackchan-mod-flash-'))
  const partitionTablePath = path.join(workDirectory, 'partition-table.bin')
  const appHeaderPath = path.join(workDirectory, 'app-header.bin')
  const connectionArgs = esptoolConnectionArguments({ chip, port, baud })

  try {
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
    const partition = findXsPartition(partitions)
    const appPartition = findAppPartition(partitions)
    if (archiveSize > partition.size) {
      throw new Error(`MOD archive exceeds xs partition: ${archiveSize} > ${partition.size}`)
    }

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
    if (expectedFirmwareVersion && firmware.version !== expectedFirmwareVersion) {
      throw new Error(`Incompatible firmware version: ${firmware.version} != ${expectedFirmwareVersion}`)
    }

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

function hex(value) {
  return `0x${value.toString(16)}`
}

function executeCommand(command, args) {
  console.log(`[stack-chan] ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) throw new Error(`Failed to run ${command}: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status ?? 'unknown'}`)
}
