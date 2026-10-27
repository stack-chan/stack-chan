import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ensureBuildOutputDirectory, moddableOutputArguments } from './lib/build-output.mjs'

// Build-only entrypoint for ordinary CoreS3, which firmware.mjs does not select.
// No port selection, deployment, reset or erase operation is exposed here.
if (process.argv.length !== 2) {
  console.error('This build-only command accepts no arguments.')
  process.exit(1)
}
ensureBuildOutputDirectory()
const result = spawnSync(
  'mcrun',
  [
    '-m',
    '-p',
    'esp32/m5stack_cores3',
    '-t',
    'build',
    ...moddableOutputArguments(),
    fileURLToPath(new URL('../mods/examples/openai_live_webrtc/manifest.memory-diagnostics.json', import.meta.url)),
  ],
  { stdio: 'inherit' },
)
if (result.error) console.error(`Diagnostic MOD build failed: ${result.error.message}`)
process.exit(result.status ?? 1)
