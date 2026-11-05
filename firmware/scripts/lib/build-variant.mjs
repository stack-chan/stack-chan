import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { webRtcSolutionFingerprint } from './webrtc-solution.mjs'

/**
 * Returns the marker path for a Moddable target whose output directory is
 * shared by multiple application manifests.
 * @param {{outputDirectory: string, deviceName: string, mode: string, applicationName: string}} options
 * @returns {string}
 */
export function buildVariantMarkerPath({ outputDirectory, deviceName, mode, applicationName }) {
  return join(outputDirectory, 'generated', 'build-variants', `${deviceName}-${mode}-${applicationName}.txt`)
}

/**
 * Returns the previously selected manifest, or null when the target has not
 * yet been built through the command wrapper.
 * @param {string} markerPath
 * @returns {string|null}
 */
export function readBuildVariant(markerPath) {
  try {
    return readFileSync(markerPath, 'utf8').trim() || null
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

/**
 * Resolves a manifest to the stable identity stored in the build marker.
 * @param {string} manifest
 * @returns {string}
 */
export function resolveBuildVariant(manifest, context) {
  const filename = resolve(manifest)
  return context ? `${filename}#${createHash('sha256').update(JSON.stringify(context)).digest('hex')}` : filename
}

/**
 * Records the manifest selected for a target after stale artifacts have been
 * cleaned.
 * @param {string} markerPath
 * @param {string} manifest
 */
export function writeBuildVariant(markerPath, manifest) {
  mkdirSync(dirname(markerPath), { recursive: true })
  writeFileSync(markerPath, `${resolveBuildVariant(manifest)}\n`)
}

/**
 * Shares the host variant/clean contract between firmware.mjs and direct
 * mcconfig builds. Unknown output (no marker) is cleaned too. The caller must
 * restore generated IDF dependencies after clean, before building or deploying.
 * A failed clean must throw so its variant is never recorded.
 */
export function prepareBuildVariant({
  outputDirectory,
  deviceName,
  mode,
  applicationName,
  manifest,
  realtime,
  solutionDirectory,
  environment = process.env,
  clean,
}) {
  if (!environment.MODDABLE || !existsSync(environment.MODDABLE)) {
    throw new Error('MODDABLE が設定されていません。`npm run setup` を実行してください。')
  }
  const markerPath = buildVariantMarkerPath({ outputDirectory, deviceName, mode, applicationName })
  const selectedManifest = resolve(manifest)
  const selectedVariant = resolveBuildVariant(manifest, {
    sdk: realpathSync(environment.MODDABLE),
    idf: environment.IDF_PATH,
    realtime,
    measured: environment.STACKCHAN_REALTIME_PERFORMANCE_PROBE,
    systemTrace: environment.STACKCHAN_REALTIME_SYSTEM_TRACE,
    solution: solutionDirectory,
    solutionRevision: solutionDirectory ? webRtcSolutionFingerprint(solutionDirectory) : undefined,
    manifest: readFileSync(selectedManifest, 'utf8'),
  })
  if (readBuildVariant(markerPath) === selectedVariant) return false

  console.log(`[stack-chan] cleaning target before manifest switch: ${manifest}`)
  clean(selectedManifest)
  writeBuildVariant(markerPath, selectedVariant)
  return true
}
