import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const directory = resolve('dist/native-tests')
mkdirSync(directory, { recursive: true })
const native = readFileSync('host/modules/muse-gadget/native/muse-native.c', 'utf8')
const delivery = native.slice(native.indexOf('static void release('), native.indexOf('static void event('))
writeFileSync(resolve(directory, 'delivery.test.c'), readFileSync('host/modules/muse-gadget/__tests__/delivery.test.c', 'utf8').replace('/* INSERT_PRODUCTION_DELIVERY */', delivery))
for (const name of ['receive', 'chat-routes', 'delivery']) {
  const binary = resolve(directory, `muse-${name}`)
  const compile = spawnSync(
    process.env.CC ?? 'cc',
    [
      '-std=c17',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-fsanitize=address,undefined',
      name === 'delivery' ? resolve(directory, 'delivery.test.c') : `host/modules/muse-gadget/__tests__/${name}.test.c`,
      '-o',
      binary,
    ],
    { stdio: 'inherit' },
  )
  if (compile.error || compile.status !== 0) process.exit(compile.status ?? 1)
  const run = spawnSync(binary, [], { stdio: 'inherit' })
  if (run.status !== 0) process.exit(run.status ?? 1)
}
