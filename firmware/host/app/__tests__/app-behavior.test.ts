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
type AppLaunchModule = typeof import('app-launch')

function installBareSpecifierPackages(): void {
  const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  writeAliasPackage(hostRoot, 'app-behavior-resolver', resolve(hostRoot, 'app/app-behavior-resolver.js'))
  writeAliasPackage(hostRoot, 'app-launch', resolve(hostRoot, 'app/app-launch.js'))
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

test('resolveAppBehaviors imports MOD independently from other archive entrypoints', async () => {
  installBareSpecifierPackages()
  const { resolveAppBehaviors } = (await import('app-behavior-resolver')) as AppBehaviorResolverModule
  const defaultBehavior: AppBehavior = { onLaunch: () => true }
  const modBehavior: AppBehavior = { onContextCreated: () => {} }
  const importedSpecifiers: string[] = []
  const modules: AppBehaviorModules = {
    has: (specifier) => specifier === 'mod' || specifier === 'miniapp',
    importNow: (specifier) => {
      importedSpecifiers.push(specifier)
      return modBehavior
    },
  }

  const [behavior] = resolveAppBehaviors(modules, defaultBehavior)
  assert.equal(behavior.onContextCreated, modBehavior.onContextCreated)
  assert.deepEqual(importedSpecifiers, ['mod'])
})

test('resolveAppBehaviors falls back to the product default when the installed MOD fails to import', async () => {
  installBareSpecifierPackages()
  const { resolveAppBehaviors } = (await import('app-behavior-resolver')) as AppBehaviorResolverModule
  const failure = new Error('invalid MOD')
  const defaultBehavior: AppBehavior = { onLaunch: () => true }
  const importErrors: unknown[] = []
  const modules: AppBehaviorModules = {
    has: () => true,
    importNow: () => {
      throw failure
    },
  }

  assert.deepEqual(
    resolveAppBehaviors(modules, defaultBehavior, (error) => importErrors.push(error)),
    [defaultBehavior],
  )
  assert.deepEqual(importErrors, [failure])
})

test('prepareAppLaunch skips post-approval preparation when a MOD rejects launch', async () => {
  installBareSpecifierPackages()
  const { prepareAppLaunch } = (await import('app-launch')) as AppLaunchModule
  const events: string[] = []

  const result = await prepareAppLaunch(
    [
      {
        onLaunch() {
          events.push('launch')
          return false
        },
      },
    ],
    () => {
      events.push('prepare')
      return 'mini-apps'
    },
  )

  assert.deepEqual(result, { shouldCreateContext: false })
  assert.deepEqual(events, ['launch'])
})

test('prepareAppLaunch prepares mini-apps after every launch behavior approves', async () => {
  installBareSpecifierPackages()
  const { prepareAppLaunch } = (await import('app-launch')) as AppLaunchModule
  const events: string[] = []

  const result = await prepareAppLaunch(
    [
      {
        onLaunch() {
          events.push('launch:first')
          return true
        },
      },
      {
        async onLaunch() {
          events.push('launch:second')
          return true
        },
      },
    ],
    () => {
      events.push('prepare')
      return 'mini-apps'
    },
  )

  assert.deepEqual(result, { shouldCreateContext: true, prepared: 'mini-apps' })
  assert.deepEqual(events, ['launch:first', 'launch:second', 'prepare'])
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
