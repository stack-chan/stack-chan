import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildOutputDirectory, firmwareDirectory } from './lib/build-output.mjs'
import { validateMuseNativeTlsConfig } from './lib/muse-native-tls-config.mjs'
import { invalidateMuseCascadedBindings, validateMuseCascadedBindings, validateRateReplayLinkedModules } from './lib/muse-cascaded-bindings.mjs'

const targets = {
  '--native': ['muse-native-device', '__tests__/device'],
  '--host': ['guruguru-muse-stopwatch', 'device-host'],
  '--sdk-provision': ['muse-sdk-provision', 'sdk-provision'],
  '--openai-provision': ['stackchan-openai-provision', 'openai-provision'],
  '--gemini-provision': ['stackchan-gemini-provision', 'gemini-provision'],
  '--cascaded-offline': ['muse-cascaded-offline-test', 'setup-device', 'manifest.offline-test.json'],
  '--wifi-provision': ['muse-wifi-provision', 'wifi-provision'],
  '--account-probe': ['muse-account-probe', 'account-probe'],
  '--note-performance': ['muse-connection-probe', 'connection-probe', 'manifest.synthetic-performance.json'],
  '--avatar-performance': ['muse-connection-probe', 'connection-probe', 'manifest.avatar-performance.json'],
  '--note-synthetic': ['muse-connection-probe', 'connection-probe', 'manifest.synthetic-conversation.json'],
  '--note-transport': ['muse-connection-probe', 'connection-probe', 'manifest.synthetic-transport.json'],
  '--connection-probe': ['muse-connection-probe', 'connection-probe'],
  '--scan-probe': ['muse-scan-probe', 'scan-probe'],
  '--setup-rate-replay': ['muse-setup-native-rate-replay-stopwatch', 'setup-device', 'manifest-rate-replay.json'],
  '--setup-native-speech': ['muse-setup-native-speech-stopwatch', 'setup-device', 'manifest-native-speech.json'],
  '--setup': ['muse-setup-stopwatch', 'setup-device'],
  '--gemini-mock': ['gemini-mock-stopwatch', 'gemini-mock-device'],
  '--pairing': ['muse-pairing-device', 'pairing/device'],
  '--audio': ['muse-audio-device', '__tests__/audio-device'],
}
const selector = process.argv[2] ?? '--native'
if (!targets[selector] || process.argv.length > 3)
  throw new Error(
    'Expected --native, --host, --pairing, --setup, --setup-native-speech, --sdk-provision, --openai-provision, --gemini-provision or --audio',
  )
const [name, directory, manifestName = 'manifest.json'] = targets[selector]
const project = join(buildOutputDirectory, 'tmp/esp32/m5stack_stopwatch/release', name, 'xsProj-esp32s3')
const cascadedSetup = ['--setup', '--setup-native-speech', '--cascaded-offline', '--setup-rate-replay'].includes(selector)
const components = join(project, 'components')
const main = join(project, 'main')
mkdirSync(components, { recursive: true })
mkdirSync(main, { recursive: true })
const source = join(firmwareDirectory, 'host/modules/muse-gadget/native/noise_component')
const destination = join(components, 'stackchan_muse_noise')
if (existsSync(destination)) {
  if (realpathSync(destination) !== realpathSync(source)) throw new Error('Unexpected Muse component destination')
} else symlinkSync(source, destination, process.platform === 'win32' ? 'junction' : 'dir')
if (
  selector === '--pairing' ||
  cascadedSetup ||
  selector === '--sdk-provision' ||
  selector === '--wifi-provision' ||
  selector === '--connection-probe' ||
  selector === '--note-performance' ||
  selector === '--avatar-performance' ||
  selector === '--note-synthetic' ||
  selector === '--note-transport' ||
  selector === '--account-probe' ||
  selector === '--gemini-mock'
) {
  const pairingSource = join(firmwareDirectory, 'host/modules/muse-gadget/native/pairing_component')
  const pairingDestination = join(components, 'stackchan_muse_pairing')
  if (existsSync(pairingDestination)) {
    if (realpathSync(pairingDestination) !== realpathSync(pairingSource))
      throw new Error('Unexpected pairing component destination')
  } else symlinkSync(pairingSource, pairingDestination, process.platform === 'win32' ? 'junction' : 'dir')
}
const manifest = join(main, 'idf_component.yml')
if (!existsSync(manifest)) writeFileSync(manifest, 'dependencies:\n  espressif/esp_websocket_client: "==1.8.0"\n')
if (cascadedSetup) {
  invalidateMuseCascadedBindings({
    directory: join(buildOutputDirectory, 'tmp/esp32/m5stack_stopwatch/release', name),
    selector,
  })
}
const result = spawnSync(
  process.execPath,
  [
    'scripts/run-mcconfig.mjs',
    '-m',
    '-p',
    'esp32/m5stack_stopwatch',
    '-t',
    'build',
    `host/modules/muse-gadget/${directory}/${manifestName}`,
  ],
  { cwd: firmwareDirectory, env: process.env, stdio: 'inherit' },
)
if (result.error) throw result.error
if (result.status === 0) validateMuseNativeTlsConfig({ project, selector })
if (result.status === 0 && cascadedSetup) {
  validateMuseCascadedBindings({
    directory: join(buildOutputDirectory, 'tmp/esp32/m5stack_stopwatch/release', name),
    firmwareDirectory,
    selector,
  })
  if (selector === '--setup-rate-replay') {
    validateRateReplayLinkedModules({
      directory: join(buildOutputDirectory, 'tmp/esp32/m5stack_stopwatch/release', name),
      firmwareDirectory,
    })
    console.log('[stack-chan] Offline rate replay linked modules verified')
  }
  console.log('[stack-chan] Muse cascaded module bindings verified')
}
process.exit(result.status ?? 1)
