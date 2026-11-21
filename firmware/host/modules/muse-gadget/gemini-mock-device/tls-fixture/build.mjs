import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
let firmware = here
while (!existsSync(join(firmware, 'scripts/run-mcconfig.mjs'))) {
  const parent = dirname(firmware)
  if (parent === firmware) throw Error('firmware root not found')
  firmware = parent
}
const variant = process.argv[2]
if (
  ![
    'burst-js',
    'burst-native',
    'realtime-js',
    'realtime-native',
    'combined-js',
    'combined-native',
    'endurance-native',
  ].includes(variant)
)
  throw Error('Expected burst-js, burst-native, realtime-js or realtime-native')
const manifest = join(here, '.generated', `manifest-${variant}.json`)
const {
  build: { NAME: name },
} = JSON.parse(readFileSync(manifest))
const project = join(firmware, 'dist/tmp/esp32/m5stack_stopwatch/release', name, 'xsProj-esp32s3')
mkdirSync(join(project, 'components'), { recursive: true })
mkdirSync(join(project, 'main'), { recursive: true })
for (const [target, source] of [
  ['stackchan_muse_noise', 'noise_component'],
  ['stackchan_muse_pairing', 'pairing_component'],
]) {
  const from = join(firmware, 'host/modules/muse-gadget/native', source)
  const to = join(project, 'components', target)
  if (!existsSync(to)) symlinkSync(from, to, process.platform === 'win32' ? 'junction' : 'dir')
  else if (realpathSync(to) !== realpathSync(from)) throw Error('Unexpected component destination')
}
const idf = join(project, 'main/idf_component.yml')
if (!existsSync(idf)) writeFileSync(idf, 'dependencies:\n  espressif/esp_websocket_client: "==1.8.0"\n')
const result = spawnSync(
  process.execPath,
  ['scripts/run-mcconfig.mjs', '-m', '-p', 'esp32/m5stack_stopwatch', '-t', 'build', manifest],
  { cwd: firmware, env: process.env, stdio: 'inherit' },
)
if (result.error) throw result.error
process.exit(result.status ?? 1)
