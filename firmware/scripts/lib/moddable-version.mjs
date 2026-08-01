import { Buffer } from 'node:buffer'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildOutputDirectory } from './build-output.mjs'

const libraryDirectory = path.dirname(fileURLToPath(import.meta.url))
export const coreS3SdkconfigSourceDirectory = path.resolve(
  libraryDirectory,
  '../../host/modules/audio/platforms/m5stackchan-cores3/sdkconfig',
)
export const STACKCHAN_HOST_API_VERSION = 1

/**
 * Reads the Moddable SDK version that must be exposed through esp_app_desc.
 * @param {string|undefined} moddableDirectory - Moddable SDK root.
 * @returns {string} Validated SDK version.
 */
export function readModdableVersion(moddableDirectory = process.env.MODDABLE) {
  if (!moddableDirectory) throw new Error('MODDABLE environment variable is required')
  const versionPath = path.join(moddableDirectory, 'tools', 'VERSION')
  let version
  try {
    version = readFileSync(versionPath, 'utf8').trim()
  } catch (error) {
    throw new Error(`Moddable SDK version could not be read: ${versionPath} (${error.message})`)
  }
  assertDescriptorVersion(version)
  return version
}

/**
 * Adds the Stack-chan host API generation to the Moddable SDK version stored in
 * esp_app_desc. Legacy firmware has no suffix and is therefore host API 0.
 * @param {string} moddableVersion - Moddable SDK version.
 * @param {number} hostApiVersion - Stack-chan host API generation.
 * @returns {string} Firmware descriptor version.
 */
export function firmwareDescriptorVersion(moddableVersion, hostApiVersion = STACKCHAN_HOST_API_VERSION) {
  assertDescriptorVersion(moddableVersion)
  if (!Number.isSafeInteger(hostApiVersion) || hostApiVersion < 1) {
    throw new Error(`Invalid Stack-chan host API version: ${hostApiVersion}`)
  }
  const separator = moddableVersion.includes('+') ? '.' : '+'
  const version = `${moddableVersion}${separator}stackchan.${hostApiVersion}`
  assertDescriptorVersion(version, 'firmware descriptor version')
  return version
}

/**
 * Produces an sdkconfig overlay with the Moddable SDK and Stack-chan host API versions.
 * @param {string} source - Base sdkconfig.defaults contents.
 * @param {string} version - Moddable SDK version for esp_app_desc.
 * @returns {string} Generated sdkconfig.defaults contents.
 */
export function renderVersionSdkconfig(source, version) {
  const descriptorVersion = firmwareDescriptorVersion(version)
  const base = source
    .replaceAll('\r\n', '\n')
    .split('\n')
    .filter((line) => !/^CONFIG_APP_PROJECT_VER(?:_FROM_CONFIG)?=/.test(line))
    .join('\n')
    .trimEnd()

  return `${base}

# Generated from $MODDABLE/tools/VERSION and the Stack-chan host API generation.
CONFIG_APP_PROJECT_VER_FROM_CONFIG=y
CONFIG_APP_PROJECT_VER="${descriptorVersion}"
`
}

/**
 * Writes a generated sdkconfig directory for Moddable's SDKCONFIGPATH.
 * @param {{platformName: string, moddableDirectory?: string, outputDirectory?: string, sourceDirectory: string, partitionSourcePath: string}} options - Generation inputs.
 * @returns {{directory: string, filePath: string, partitionFilePath: string, version: string, moddableVersion: string}} Generated configuration details.
 */
export function prepareVersionSdkconfig({
  platformName,
  moddableDirectory = process.env.MODDABLE,
  outputDirectory = buildOutputDirectory,
  sourceDirectory,
  partitionSourcePath,
}) {
  if (!/^[0-9A-Za-z._-]+$/.test(platformName)) {
    throw new Error(`Invalid sdkconfig platform name: ${platformName || 'missing'}`)
  }
  const moddableVersion = readModdableVersion(moddableDirectory)
  const version = firmwareDescriptorVersion(moddableVersion)
  const sourcePath = path.join(sourceDirectory, 'sdkconfig.defaults')
  const source = readFileSync(sourcePath, 'utf8')
  const sdkconfig = renderVersionSdkconfig(source, moddableVersion)
  const directory = path.join(outputDirectory, 'generated', 'sdkconfig', platformName)
  const filePath = path.join(directory, 'sdkconfig.defaults')
  const partitionFilePath = path.join(directory, 'partitions.csv')
  const partitions = readFileSync(partitionSourcePath)

  mkdirSync(directory, { recursive: true })
  const previous = existsSync(filePath) ? readFileSync(filePath, 'utf8') : null
  if (previous !== sdkconfig) writeFileSync(filePath, sdkconfig)
  const previousPartitions = existsSync(partitionFilePath) ? readFileSync(partitionFilePath) : null
  if (!previousPartitions?.equals(partitions)) writeFileSync(partitionFilePath, partitions)

  console.log(`[stack-chan] prepared firmware version ${version}: ${filePath}`)
  return { directory, filePath, partitionFilePath, version, moddableVersion }
}

/**
 * Writes the M5StackChan CoreS3 sdkconfig overlay used by normal firmware builds.
 * @param {{platformName?: "m5stack_cores3" | "m5stackchan_cores3", moddableDirectory?: string, outputDirectory?: string, sourceDirectory?: string, partitionSourcePath?: string}} options - Generation inputs.
 * @returns {{directory: string, filePath: string, partitionFilePath: string, version: string, moddableVersion: string}} Generated configuration details.
 */
export function prepareCoreS3VersionSdkconfig({
  platformName = 'm5stackchan_cores3',
  moddableDirectory = process.env.MODDABLE,
  outputDirectory = buildOutputDirectory,
  sourceDirectory,
  partitionSourcePath = path.join(
    moddableDirectory ?? '',
    'build',
    'devices',
    'esp32',
    'targets',
    'm5stack_cores3',
    'sdkconfig',
    'partitions.csv',
  ),
} = {}) {
  if (!['m5stack_cores3', 'm5stackchan_cores3'].includes(platformName))
    throw new Error(`Unsupported CoreS3 sdkconfig platform: ${platformName}`)
  sourceDirectory ??=
    platformName === 'm5stack_cores3'
      ? path.join(moddableDirectory ?? '', 'build', 'devices', 'esp32', 'targets', 'm5stack_cores3', 'sdkconfig')
      : coreS3SdkconfigSourceDirectory

  return prepareVersionSdkconfig({
    platformName,
    moddableDirectory,
    outputDirectory,
    sourceDirectory,
    partitionSourcePath,
  })
}

export const renderCoreS3VersionSdkconfig = renderVersionSdkconfig

/**
 * Validates a version before embedding it in a quoted Kconfig value and the
 * 32-byte esp_app_desc version field.
 * @param {string} version - Candidate version.
 */
function assertDescriptorVersion(version, label = 'Moddable SDK version') {
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(version) || Buffer.byteLength(version, 'utf8') > 31) {
    throw new Error(`Invalid ${label} for esp_app_desc: ${version || 'missing'}`)
  }
}
