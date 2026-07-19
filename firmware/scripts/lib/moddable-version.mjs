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
 * Produces the CoreS3 sdkconfig overlay with the actual Moddable SDK version.
 * @param {string} source - Base sdkconfig.defaults contents.
 * @param {string} version - Moddable SDK version for esp_app_desc.
 * @returns {string} Generated sdkconfig.defaults contents.
 */
export function renderCoreS3VersionSdkconfig(source, version) {
  assertDescriptorVersion(version)
  const base = source
    .replaceAll('\r\n', '\n')
    .split('\n')
    .filter((line) => !/^CONFIG_APP_PROJECT_VER(?:_FROM_CONFIG)?=/.test(line))
    .join('\n')
    .trimEnd()

  return `${base}

# Generated from $MODDABLE/tools/VERSION by scripts/lib/moddable-version.mjs.
CONFIG_APP_PROJECT_VER_FROM_CONFIG=y
CONFIG_APP_PROJECT_VER="${version}"
`
}

/**
 * Writes a generated CoreS3 sdkconfig directory for Moddable's SDKCONFIGPATH.
 * @param {{moddableDirectory?: string, outputDirectory?: string, sourceDirectory?: string}} options - Generation inputs.
 * @returns {{directory: string, filePath: string, version: string}} Generated configuration details.
 */
export function prepareCoreS3VersionSdkconfig({
  moddableDirectory = process.env.MODDABLE,
  outputDirectory = buildOutputDirectory,
  sourceDirectory = coreS3SdkconfigSourceDirectory,
} = {}) {
  const version = readModdableVersion(moddableDirectory)
  const sourcePath = path.join(sourceDirectory, 'sdkconfig.defaults')
  const source = readFileSync(sourcePath, 'utf8')
  const sdkconfig = renderCoreS3VersionSdkconfig(source, version)
  const directory = path.join(outputDirectory, 'generated', 'sdkconfig', 'm5stackchan_cores3')
  const filePath = path.join(directory, 'sdkconfig.defaults')

  mkdirSync(directory, { recursive: true })
  const previous = existsSync(filePath) ? readFileSync(filePath, 'utf8') : null
  if (previous !== sdkconfig) writeFileSync(filePath, sdkconfig)

  console.log(`[stack-chan] prepared CoreS3 firmware version ${version}: ${filePath}`)
  return { directory, filePath, version }
}

/**
 * Validates a version before embedding it in a quoted Kconfig value and the
 * 32-byte esp_app_desc version field.
 * @param {string} version - Candidate version.
 */
function assertDescriptorVersion(version) {
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(version) || Buffer.byteLength(version, 'utf8') > 31) {
    throw new Error(`Invalid Moddable SDK version for esp_app_desc: ${version || 'missing'}`)
  }
}
