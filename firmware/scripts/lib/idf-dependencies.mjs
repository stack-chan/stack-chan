import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const dependenciesByPlatform = {
  m5stack_cores3: [
    ['espressif/esp-sr', '2.4.6'],
    ['espressif/esp32-camera', '^2.0.10'],
  ],
  m5stackchan_cores3: [
    ['espressif/esp-sr', '2.4.6'],
    ['espressif/esp_audio_codec', '^2.6.0'],
    ['espressif/esp32-camera', '^2.0.10'],
  ],
}

/**
 * Seeds a generated CoreS3 IDF manifest before Moddable adds dependencies.
 * @param {{outputDirectory: string, platformName: string, applicationName: string, mode: string}} options - Build output configuration.
 * @returns {string} Path to the prepared IDF component manifest.
 */
export function prepareCoreS3IdfDependencies({ outputDirectory, platformName, applicationName, mode }) {
  if (!outputDirectory) throw new Error('Build output directory is required')
  const dependencies = dependenciesByPlatform[platformName]
  if (!dependencies) throw new Error(`Unsupported CoreS3 platform: ${platformName}`)
  if (!applicationName) throw new Error('Application name is required')
  if (!['debug', 'instrument', 'release'].includes(mode)) throw new Error(`Unsupported build mode: ${mode}`)

  const mainDirectory = path.join(
    outputDirectory,
    'tmp',
    'esp32',
    platformName,
    mode,
    applicationName,
    'xsProj-esp32s3',
    'main',
  )
  const manifestPath = path.join(mainDirectory, 'idf_component.yml')
  mkdirSync(mainDirectory, { recursive: true })

  const originalManifest = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : null
  let manifest =
    originalManifest ?? "## IDF Component Manager Manifest File\ndependencies:\n  idf:\n    version: '>=4.1.0'\n"

  if (!/^dependencies:\s*$/m.test(manifest)) {
    throw new Error(`IDF component manifest has no dependencies block: ${manifestPath}`)
  }

  for (const [name, version] of dependencies) {
    if (manifest.includes(`  ${name}:`)) continue
    if (!manifest.endsWith('\n')) manifest += '\n'
    manifest += `  ${name}: ${version}\n`
  }

  // Moddable 8.3.1 joins multiple `idf.py add-dependency` commands with `&` on
  // POSIX, so clean builds can race while updating this file. Seed both entries
  // before mcconfig runs and its generated checks become no-ops.
  if (manifest !== originalManifest) writeFileSync(manifestPath, manifest)

  const projectDirectory = path.dirname(mainDirectory)
  const dependencyLockPath = path.join(projectDirectory, 'dependencies.lock')
  const dependencyLock = existsSync(dependencyLockPath) ? readFileSync(dependencyLockPath, 'utf8') : ''
  const lockIsStale = dependencies.some(([name, constraint]) => {
    const lockedVersion = readLockedDependencyVersion(dependencyLock, name)
    return !lockedVersion || !lockedVersionSatisfies(lockedVersion, constraint)
  })
  if (lockIsStale) {
    const sdkconfigHeaderPath = path.join(projectDirectory, 'build', 'config', 'sdkconfig.h')
    if (existsSync(sdkconfigHeaderPath)) {
      rmSync(sdkconfigHeaderPath)
      console.log(`[stack-chan] invalidated stale IDF dependency configuration: ${sdkconfigHeaderPath}`)
    }
  }

  console.log(`[stack-chan] prepared IDF dependencies: ${manifestPath}`)
  return manifestPath
}

/**
 * Reads one top-level component version from an IDF Component Manager lock.
 * Nested dependency constraints use the same package names, so the indentation
 * is part of the maintained lock-file contract.
 * @param {string} dependencyLock - Generated dependencies.lock contents.
 * @param {string} name - Component registry name.
 * @returns {string | undefined} Exact locked version.
 */
function readLockedDependencyVersion(dependencyLock, name) {
  const lines = dependencyLock.split(/\r?\n/)
  const entryStart = lines.indexOf(`  ${name}:`)
  if (entryStart < 0) return undefined

  for (let index = entryStart + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^ {2}\S/.test(line)) break
    const match = /^ {4}version:\s+['"]?([^'"\s]+)['"]?\s*$/.exec(line)
    if (match) return match[1]
  }
  return undefined
}

/**
 * Checks the exact and caret constraints used by the generated CoreS3
 * component manifests.
 * @param {string} version - Exact version from dependencies.lock.
 * @param {string} constraint - Manifest version requirement.
 * @returns {boolean} Whether the lock remains compatible with the manifest.
 */
function lockedVersionSatisfies(version, constraint) {
  if (!constraint.startsWith('^')) return version === constraint

  const locked = parseComparableVersion(version)
  const minimum = parseComparableVersion(constraint.slice(1))
  if (!locked || !minimum || compareVersions(locked, minimum) < 0) return false
  if (minimum[0] > 0) return locked[0] === minimum[0]
  if (minimum[1] > 0) return locked[0] === 0 && locked[1] === minimum[1]
  return locked[0] === 0 && locked[1] === 0 && locked[2] === minimum[2]
}

function parseComparableVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[~+-].*)?$/.exec(value)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}
