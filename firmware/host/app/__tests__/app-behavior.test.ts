import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import type { AppBehaviorModules } from 'app-behavior-resolver'
import { writeAliasPackage } from '../../modules/testing/node-alias-package.js'

type AppBehavior = {
  onLaunch?: () => boolean
}

type AppBehaviorResolverModule = typeof import('app-behavior-resolver')

function installBareSpecifierPackages(): void {
  const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  writeAliasPackage(hostRoot, 'app-behavior-resolver', resolve(hostRoot, 'app/app-behavior-resolver.js'))
}

test('resolveAppBehaviors runs only the product default behavior when no MOD is installed', async () => {
  installBareSpecifierPackages()
  const { resolveAppBehaviors } = (await import('app-behavior-resolver')) as AppBehaviorResolverModule
  const defaultBehavior: AppBehavior = { onLaunch: () => true }
  const modules: AppBehaviorModules<AppBehavior> = {
    has: (specifier) => {
      assert.equal(specifier, 'mod')
      return false
    },
    importNow: () => {
      throw new Error('default behavior path must not import an installed MOD')
    },
  }

  assert.deepEqual(resolveAppBehaviors(modules, defaultBehavior), [defaultBehavior])
})

test('resolveAppBehaviors lets an installed MOD replace the product default behavior', async () => {
  installBareSpecifierPackages()
  const { resolveAppBehaviors } = (await import('app-behavior-resolver')) as AppBehaviorResolverModule
  const defaultBehavior: AppBehavior = { onLaunch: () => true }
  const modBehavior: AppBehavior = { onLaunch: () => false }
  const importedSpecifiers: string[] = []
  const modules: AppBehaviorModules<AppBehavior> = {
    has: (specifier) => {
      assert.equal(specifier, 'mod')
      return true
    },
    importNow: (specifier) => {
      importedSpecifiers.push(specifier)
      return modBehavior
    },
  }

  assert.deepEqual(resolveAppBehaviors(modules, defaultBehavior), [modBehavior])
  assert.deepEqual(importedSpecifiers, ['mod'])
})
