import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeAliasPackage, writeAliasPackageSubpath } from '../../modules/testing/node-alias-package.js'

export function installRuntimeTestAliases(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  for (const name of [
    'owned-resources',
    'runtime-resources',
    'camera-capture-session',
    'operation-queue',
    'app-audio-session',
    'cancellation',
  ]) {
    writeAliasPackage(root, name, resolve(root, `app/${name}.js`))
  }
  writeAliasPackageSubpath(root, 'stackchan', 'errors', resolve(root, '../sdk/errors.js'))
  // Other tests install packages at these nearer roots too. Populate every
  // contract used by this runtime rather than relying on their import order.
  for (const base of [root, resolve(root, 'app'), resolve(root, 'modules')])
    for (const name of ['audio-recording', 'audio-playback'])
      writeAliasPackageSubpath(base, 'stackchan-contracts', name, resolve(root, `../contracts/${name}.js`))
  writeAliasPackage(root, 'tts-playback-session', resolve(root, 'modules/audio/tts-playback-session.js'))
  writeAliasPackage(root, 'recorded-audio', resolve(root, 'modules/audio/recorded-audio.js'))
  writeAliasPackage(root, 'pcm-wave', resolve(root, 'modules/audio/pcm-wave.js'))
  writeAliasPackage(root, 'timer', resolve(root, 'modules/testing/fakes/timer.js'), { hasDefaultExport: true })
  ;(globalThis as typeof globalThis & { trace: (message: string) => void }).trace = () => {}
}
