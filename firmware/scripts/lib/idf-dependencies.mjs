import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dependenciesByPlatform = {
  m5stack_cores3: [['espressif/esp32-camera', '^2.0.10']],
  m5stackchan_cores3: [
    ['espressif/esp_audio_codec', '~2.5.0'],
    ['espressif/esp32-camera', '^2.0.10'],
  ],
}

/**
 * Seeds a generated CoreS3 IDF manifest before Moddable adds dependencies.
 * @param {{outputDirectory: string, platformName: string, applicationName: string, mode: string}} options - Build output configuration.
 * @returns {string} Path to the prepared IDF component manifest.
 */
export function prepareCoreS3IdfDependencies({
  outputDirectory,
  platformName,
  applicationName,
  mode,
  realtime = false,
  solutionDirectory,
  performanceProbe = false,
  systemTrace = false,
}) {
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

  if (systemTrace) {
    if (!realtime || !performanceProbe)
      throw new Error('System tracing requires the RealtimeConversation performance probe')
    const traceManifest = JSON.parse(
      readFileSync(
        new URL('../../host/modules/realtime-conversation/__tests__/task-trace/manifest.json', import.meta.url),
      ),
    )
    const version = traceManifest.platforms['esp32/m5stackchan_cores3'].dependency.find(
      (d) => d.name === 'esp_sysview',
    ).version
    const requirement = `  espressif/esp_sysview: '${version}'\n`
    if (/^ {2}espressif\/esp_sysview:.*$/m.test(manifest))
      manifest = manifest.replace(/^ {2}espressif\/esp_sysview:.*\n/m, requirement)
    else manifest += requirement
  } else {
    manifest = manifest.replace(/^ {2}espressif\/esp_sysview:.*\n/m, '')
  }

  if (realtime) {
    if (platformName !== 'm5stackchan_cores3' || !solutionDirectory)
      throw new Error('RealtimeConversation requires CoreS3 and ESP_WEBRTC_SOLUTION')
    const components = ['esp_webrtc', 'esp_peer', 'media_lib_utils', 'webrtc_utils', 'av_render']
    const componentDirectory = path.join(mainDirectory, '..', 'components')
    mkdirSync(componentDirectory, { recursive: true })
    for (const name of components) {
      const source = path.resolve(solutionDirectory, 'components', name)
      if (!existsSync(path.join(source, 'CMakeLists.txt'))) throw new Error(`Missing WebRTC component: ${name}`)
      linkComponent(source, path.join(componentDirectory, name))
    }
    // Use ESP-IDF's project component discovery; never patch the SDK CMake project.
    const conversation = JSON.parse(
      readFileSync(new URL('../../host/modules/realtime-conversation/manifest.json', import.meta.url)),
    )
    for (const { name, version } of conversation.platforms['esp32/m5stackchan_cores3'].dependency) {
      if (name && !manifest.includes(`  espressif/${name}:`)) manifest += `  espressif/${name}: '${version}'\n`
    }
    const probeLink = path.join(componentDirectory, 'realtime_measurement')
    if (performanceProbe) {
      linkComponent(
        fileURLToPath(
          new URL('../../host/modules/realtime-conversation/__tests__/measurement-component', import.meta.url),
        ),
        probeLink,
      )
    } else if (existsSync(probeLink)) {
      if (!lstatSync(probeLink).isSymbolicLink())
        throw new Error('Refusing to replace non-generated measurement component')
      unlinkSync(probeLink)
    }
  }

  // Moddable 8.3.1 joins multiple `idf.py add-dependency` commands with `&` on
  // POSIX, so clean builds can race while updating this file. Seed both entries
  // before mcconfig runs and its generated checks become no-ops.
  if (manifest !== originalManifest) writeFileSync(manifestPath, manifest)
  console.log(`[stack-chan] prepared IDF dependencies: ${manifestPath}`)
  return manifestPath
}

function linkComponent(source, destination) {
  const current = lstatSync(destination, { throwIfNoEntry: false })
  if (current) {
    if (!current.isSymbolicLink()) throw new Error(`Refusing to replace component directory: ${destination}`)
    if (existsSync(destination) && realpathSync(destination) === realpathSync(source)) return
    unlinkSync(destination)
  }
  symlinkSync(source, destination, 'dir')
}
