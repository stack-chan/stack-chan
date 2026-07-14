import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const m5stackchanCoreS3Dependencies = [
  ['espressif/esp_audio_codec', '^2.6.0'],
  ['espressif/esp32-camera', '^2.0.10'],
]

/** Seeds the generated CoreS3 IDF manifest before Moddable adds dependencies. */
export function prepareM5StackChanCoreS3IdfDependencies({ moddableDirectory, mode }) {
  if (!moddableDirectory) throw new Error('MODDABLE environment variable is required')
  if (!['debug', 'instrument', 'release'].includes(mode)) throw new Error(`Unsupported build mode: ${mode}`)

  const mainDirectory = path.join(
    moddableDirectory,
    'build',
    'tmp',
    'esp32',
    'm5stackchan_cores3',
    mode,
    'app',
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

  for (const [name, version] of m5stackchanCoreS3Dependencies) {
    if (manifest.includes(`  ${name}:`)) continue
    if (!manifest.endsWith('\n')) manifest += '\n'
    manifest += `  ${name}: ${version}\n`
  }

  // Moddable 8.3.1 joins multiple `idf.py add-dependency` commands with `&` on
  // POSIX, so clean builds can race while updating this file. Seed both entries
  // before mcconfig runs and its generated checks become no-ops.
  if (manifest !== originalManifest) writeFileSync(manifestPath, manifest)
  console.log(`[stack-chan] prepared IDF dependencies: ${manifestPath}`)
  return manifestPath
}
