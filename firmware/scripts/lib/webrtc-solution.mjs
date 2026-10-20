import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { buildOutputDirectory } from './build-output.mjs'

export const webRtcSolutionRevision = 'c8650846b512e6e1375e5f78c1c41619b8d645eb'
export const webRtcComponents = ['esp_webrtc', 'esp_peer', 'media_lib_utils', 'webrtc_utils', 'av_render']
const repository = 'https://github.com/espressif/esp-webrtc-solution.git'

/** Examines local includes for the public capability, leaving SDK manifests to mcconfig. */
export function manifestUsesWebRtc(manifestPath, platformName) {
  const visited = new Set()
  function visit(filename) {
    if (statSync(filename).isDirectory()) filename = path.join(filename, 'manifest.json')
    if (visited.has(filename)) return false
    visited.add(filename)
    const manifest = JSON.parse(readFileSync(filename, 'utf8'))
    if (manifest.modules?.realtimeConversation) return true
    const platform = manifest.platforms?.[`esp32/${platformName}`]
    const includes = [manifest.include, platform?.include].flat().filter(Boolean)
    return includes.some((include) => {
      if (typeof include !== 'string' || include.includes('$(')) return false
      return visit(path.resolve(path.dirname(filename), include))
    })
  }
  return visit(path.resolve(manifestPath))
}

/** Keeps external sources in this workspace; never modifies the Moddable SDK. */
export function prepareWebRtcSolution({
  solutionDirectory = process.env.ESP_WEBRTC_SOLUTION,
  outputDirectory = buildOutputDirectory,
} = {}) {
  if (solutionDirectory) return validateSolution(path.resolve(solutionDirectory))
  const directory = path.join(outputDirectory, 'dependencies', 'esp-webrtc-solution')
  const head = git(directory, ['rev-parse', 'HEAD'], false)
  if (head !== webRtcSolutionRevision) {
    mkdirSync(directory, { recursive: true })
    git(directory, ['init', '--quiet'])
    git(directory, ['fetch', '--depth=1', repository, webRtcSolutionRevision])
    git(directory, ['checkout', '--detach', '--quiet', 'FETCH_HEAD'])
  }
  return validateSolution(directory)
}

export function webRtcSolutionFingerprint(directory) {
  const hash = createHash('sha256')
  function visit(relative) {
    for (const entry of readdirSync(path.join(directory, relative), { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const filename = path.join(relative, entry.name)
      if (entry.isDirectory()) visit(filename)
      else hash.update(filename).update(readFileSync(path.join(directory, filename)))
    }
  }
  for (const name of webRtcComponents) visit(path.join('components', name))
  return `${git(directory, ['rev-parse', 'HEAD'], false) ?? 'sources'}:${hash.digest('hex')}`
}

function validateSolution(directory) {
  for (const name of webRtcComponents)
    if (!existsSync(path.join(directory, 'components', name, 'CMakeLists.txt')))
      throw new Error(`Missing WebRTC component: ${name} (${directory})`)
  return directory
}

function git(directory, args, required = true) {
  const result = spawnSync('git', ['-C', directory, ...args], { encoding: 'utf8' })
  if (result.error || result.status !== 0) {
    if (!required) return undefined
    throw new Error(`WebRTC dependency git ${args[0]} failed: ${result.error?.message ?? result.stderr.trim()}`)
  }
  return result.stdout.trim()
}
