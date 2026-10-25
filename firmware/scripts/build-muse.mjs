import { spawnSync } from 'node:child_process'

if (process.argv.length !== 2) throw new Error('build:muse takes no arguments; it never flashes')
const result = spawnSync(
  process.execPath,
  [
    'scripts/firmware.mjs',
    'build',
    'm5stackchan_cores3',
    '--mode=release',
    '--manifest',
    'host/app/manifest_muse.json',
  ],
  { stdio: 'inherit' },
)
process.exit(result.status ?? 1)
