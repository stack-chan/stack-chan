import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeAliasPackage, writeAliasPackageSubpath } from '../../modules/testing/node-alias-package.js'

export function installRuntimeTestAliases(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  for (const name of ['owned-resources', 'runtime-resources', 'camera-capture-session', 'operation-queue']) {
    writeAliasPackage(root, name, resolve(root, `app/${name}.js`))
  }
  writeAliasPackageSubpath(root, 'stackchan', 'errors', resolve(root, '../sdk/errors.js'))
  writeAliasPackage(root, 'timer', resolve(root, 'modules/testing/fakes/timer.js'), { hasDefaultExport: true })
  ;(globalThis as typeof globalThis & { trace: (message: string) => void }).trace = () => {}
}
