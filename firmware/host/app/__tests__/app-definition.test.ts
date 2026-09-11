import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { AppModules } from 'app-definition'
import { writeAliasPackage } from '../../modules/testing/node-alias-package.js'
import { installRuntimeTestAliases } from './runtime-test-aliases.js'

const defaultApp = { apiVersion: 2 as const, setup() {} }

type AppDefinitionModule = typeof import('app-definition')
type AppLaunchModule = typeof import('app-launch')

test('resolveAppDefinition preserves V2 setup without inheriting legacy hooks', async () => {
  installBareSpecifierPackages()
  const { resolveAppDefinition } = (await import('app-definition')) as AppDefinitionModule
  const app = { apiVersion: 2 as const, setup() {} }
  const program = resolveAppDefinition({ has: () => true, importNow: () => app }, defaultApp)
  assert.equal(program, app)
})

test('legacy, future and malformed exports are rejected with migration guidance', async () => {
  installBareSpecifierPackages()
  const { resolveAppDefinition } = await import('app-definition')
  for (const app of [null, 4, { onLaunch() {} }, { apiVersion: 1 }, { apiVersion: 3, setup() {} }, { apiVersion: 2 }])
    assert.throws(
      () => resolveAppDefinition({ has: () => true, importNow: () => app }, defaultApp),
      /defineApp.*rebuild/,
    )
})

test('resolveAppDefinition refuses unsupported generations and broken imports before running defaults', async () => {
  installBareSpecifierPackages()
  const { resolveAppDefinition } = (await import('app-definition')) as AppDefinitionModule
  assert.throws(
    () => resolveAppDefinition({ has: () => true, importNow: () => ({ apiVersion: 3, setup() {} }) }, defaultApp),
    /Unsupported/,
  )
  assert.throws(
    () =>
      resolveAppDefinition(
        {
          has: () => true,
          importNow: () => {
            throw new Error('import failed')
          },
        },
        defaultApp,
      ),
    /import failed/,
  )
})

function installBareSpecifierPackages(): void {
  installRuntimeTestAliases()
  const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  writeAliasPackage(hostRoot, 'app-definition', resolve(hostRoot, 'app/app-definition.js'))
  writeAliasPackage(hostRoot, 'app-launch', resolve(hostRoot, 'app/app-launch.js'))
}

test('resolveAppDefinition runs only the product default behavior when no MOD is installed', async () => {
  installBareSpecifierPackages()
  const { resolveAppDefinition } = (await import('app-definition')) as AppDefinitionModule
  const modules: AppModules = {
    has: (specifier) => {
      assert.equal(specifier, 'mod')
      return false
    },
    importNow: () => {
      throw new Error('default behavior path must not import an installed MOD')
    },
  }

  assert.equal(resolveAppDefinition(modules, defaultApp), defaultApp)
})

test('installLaunchShortcut opens on release without replacing the existing button handler', async () => {
  installBareSpecifierPackages()
  const { installLaunchShortcut } = (await import('app-launch')) as AppLaunchModule
  const events: string[] = []
  const button = {
    value: 0,
    read() {
      return this.value
    },
    onChanged() {
      events.push('button')
    },
  }
  installLaunchShortcut(button, () => events.push('open'))

  button.value = 1
  button.onChanged()
  button.value = 0
  button.onChanged()
  button.onChanged()
  await Promise.resolve()
  assert.deepEqual(events, ['button', 'button', 'button', 'open'])
})
