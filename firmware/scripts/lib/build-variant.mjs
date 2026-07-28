import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

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
export function resolveBuildVariant(manifest) {
  return resolve(manifest)
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
