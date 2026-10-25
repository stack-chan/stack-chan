import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const directory = resolve('dist/native-tests')
mkdirSync(directory, { recursive: true })
const binary = resolve(directory, 'muse-receive')
const compile = spawnSync(
  process.env.CC ?? 'cc',
  [
    '-std=c17',
    '-Wall',
    '-Wextra',
    '-Werror',
    '-fsanitize=address,undefined',
    'host/modules/muse-gadget/__tests__/receive.test.c',
    '-o',
    binary,
  ],
  { stdio: 'inherit' },
)
if (compile.error || compile.status !== 0) process.exit(compile.status ?? 1)
const run = spawnSync(binary, [], { stdio: 'inherit' })
process.exit(run.status ?? 1)
