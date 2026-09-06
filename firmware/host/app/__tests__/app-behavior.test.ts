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

test('resolveAppProgram preserves V2 setup without inheriting legacy hooks', async () => {
  installBareSpecifierPackages()
  const { resolveAppProgram } = (await import('app-behavior-resolver')) as AppBehaviorResolverModule
  const app = { apiVersion: 2 as const, setup() {} }
  const program = resolveAppProgram({ has: () => true, importNow: () => app }, { onContextCreated() {} }, 2)
  assert.deepEqual(program, { generation: 2, app })
  assert.equal('behaviors' in program, false)
})

test('resolveAppProgram rejects exports from a different generation than the validated declaration', async () => {
  installBareSpecifierPackages()
  const { resolveAppProgram } = (await import('app-behavior-resolver')) as AppBehaviorResolverModule
  for (const [app, declared] of [
    [{ onLaunch() {} }, 2],
    [{ apiVersion: 2, setup() {} }, 1],
  ] as const) {
    assert.throws(
      () => resolveAppProgram({ has: () => true, importNow: () => app }, {}, declared),
      /does not match its declared app API generation/,
    )
  }
})

test('resolveAppProgram refuses unsupported generations and broken imports before running defaults', async () => {
  installBareSpecifierPackages()
  const { resolveAppProgram } = (await import('app-behavior-resolver')) as AppBehaviorResolverModule
  assert.throws(
    () => resolveAppProgram({ has: () => true, importNow: () => ({ apiVersion: 3, setup() {} }) }, {}),
    /Unsupported/,
  )
  assert.throws(
    () =>
      resolveAppProgram(
        {
          has: () => true,
          importNow: () => {
            throw new Error('import failed')
          },
        },
        {},
      ),
    /import failed/,
  )
})

function installBareSpecifierPackages(): void {
  const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  writeAliasPackage(hostRoot, 'app-behavior-resolver', resolve(hostRoot, 'app/app-behavior-resolver.js'))
  writeAliasPackage(hostRoot, 'app-launch', resolve(hostRoot, 'app/app-launch.js'))
}

test('resolveAppProgram runs only the product default behavior when no MOD is installed', async () => {
  installBareSpecifierPackages()
  const { resolveAppProgram } = (await import('app-behavior-resolver')) as AppBehaviorResolverModule
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

  assert.deepEqual(resolveAppProgram(modules, defaultBehavior), { generation: 1, behaviors: [defaultBehavior] })
})

test('launch hooks stop at the first rejection and otherwise run in order', async () => {
  installBareSpecifierPackages()
  const { runLaunchBehaviors } = (await import('app-launch')) as AppLaunchModule
  for (const approved of [false, true]) {
    const events: string[] = []
    const result = await runLaunchBehaviors([
      {
        onLaunch() {
          events.push('first')
          return approved
        },
      },
      {
        async onLaunch() {
          events.push('second')
          return true
        },
      },
    ])
    assert.equal(result, approved)
    assert.deepEqual(events, approved ? ['first', 'second'] : ['first'])
  }
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
