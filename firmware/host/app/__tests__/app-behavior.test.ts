import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import type { AppBehaviorModules } from 'app-behavior-resolver'
import { writeAliasPackage } from '../../modules/testing/node-alias-package.js'

type AppBehavior = {
  onLaunch?: () => boolean
  onContextCreated?: () => void
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
  const modules: AppBehaviorModules = {
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

test('resolveAppBehaviors lets an installed MOD override defined behavior hooks', async () => {
  installBareSpecifierPackages()
  const { resolveAppBehaviors } = (await import('app-behavior-resolver')) as AppBehaviorResolverModule
  const defaultLaunch = () => true
  const defaultContextCreated = () => {}
  const modLaunch = () => false
  const defaultBehavior: AppBehavior = { onLaunch: defaultLaunch, onContextCreated: defaultContextCreated }
  const modBehavior: AppBehavior = { onLaunch: modLaunch }
  const importedSpecifiers: string[] = []
  const modules: AppBehaviorModules = {
    has: (specifier) => {
      assert.equal(specifier, 'mod')
      return true
    },
    importNow: (specifier) => {
      importedSpecifiers.push(specifier)
      return modBehavior
    },
  }

  const [behavior] = resolveAppBehaviors(modules, defaultBehavior)
  assert.equal(behavior.onLaunch, modLaunch)
  assert.equal(behavior.onContextCreated, defaultContextCreated)
  assert.deepEqual(importedSpecifiers, ['mod'])
})

test('resolveAppBehaviors falls back to default launch when MOD only handles context creation', async () => {
  installBareSpecifierPackages()
  const { resolveAppBehaviors } = (await import('app-behavior-resolver')) as AppBehaviorResolverModule
  const defaultLaunch = () => true
  const defaultContextCreated = () => {}
  const modContextCreated = () => {}
  const defaultBehavior: AppBehavior = { onLaunch: defaultLaunch, onContextCreated: defaultContextCreated }
  const modBehavior: AppBehavior = { onContextCreated: modContextCreated }
  const modules: AppBehaviorModules = {
    has: (specifier) => {
      assert.equal(specifier, 'mod')
      return true
    },
    importNow: () => modBehavior,
  }

  const [behavior] = resolveAppBehaviors(modules, defaultBehavior)
  assert.equal(behavior.onLaunch, defaultLaunch)
  assert.equal(behavior.onContextCreated, modContextCreated)
})
