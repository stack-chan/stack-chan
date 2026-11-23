import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { StackchanContext } from '../modules/testing/fakes/capabilities.js'
import { writeAliasPackage } from '../modules/testing/node-alias-package.js'
import { err, ok } from '../modules/util/result.js'

type ModKitModule = typeof import('./mod-kit.js')

function installAliases(): void {
  const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  writeAliasPackage(hostRoot, 'owned-resources', resolve(hostRoot, 'app/owned-resources.js'))
  writeAliasPackage(hostRoot, 'stackchan-result', resolve(hostRoot, 'modules/util/result.js'))
}

test('defineMod runs registered cleanups in LIFO order on onClose and is idempotent', async () => {
  installAliases()
  const { defineMod } = (await import('./mod-kit.js')) as ModKitModule
  const events: string[] = []

  const mod = defineMod({
    setup(_context, _option, scope) {
      scope.own(() => {
        events.push('first')
      })
      scope.own(async () => {
        await Promise.resolve()
        events.push('second')
      })
    },
  })

  await mod.onContextCreated?.({} as StackchanContext, { config: {} as never })
  assert.deepEqual(events, [])

  await mod.onClose?.()
  await mod.onClose?.()
  assert.deepEqual(events, ['second', 'first'])
})

test('defineMod runs re-entrantly registered scope.own cleanups during normal onClose and synchronous rollback', async () => {
  installAliases()
  const { defineMod } = (await import('./mod-kit.js')) as ModKitModule
  const closeEvents: string[] = []

  const mod = defineMod({
    setup(_context, _option, scope) {
      scope.own(() => {
        closeEvents.push('outer')
        scope.own(() => {
          closeEvents.push('inner')
        })
      })
    },
  })

  await mod.onContextCreated?.({} as StackchanContext, { config: {} as never })
  await mod.onClose?.()
  assert.deepEqual(closeEvents, ['outer', 'inner'])

  const rollbackEvents: string[] = []
  const failingMod = defineMod({
    setup(_context, _option, scope) {
      scope.own(() => {
        rollbackEvents.push('outer-rollback')
        scope.own(() => {
          rollbackEvents.push('inner-rollback')
        })
      })
      throw new Error('sync failure')
    },
  })

  assert.throws(() => failingMod.onContextCreated?.({} as StackchanContext, { config: {} as never }), /sync failure/)
  assert.deepEqual(rollbackEvents, ['outer-rollback', 'inner-rollback'])
})

test('defineMod rolls back already-owned resources synchronously if setup throws synchronously', async () => {
  installAliases()
  const { defineMod } = (await import('./mod-kit.js')) as ModKitModule
  const events: string[] = []

  const mod = defineMod({
    setup(_context, _option, scope) {
      scope.own(() => {
        events.push('cleaned')
      })
      throw new Error('setup failed')
    },
  })

  assert.throws(() => mod.onContextCreated?.({} as StackchanContext, { config: {} as never }), /setup failed/)
  assert.deepEqual(events, ['cleaned'])
})

test('defineMod rolls back already-owned resources if async setup rejects', async () => {
  installAliases()
  const { defineMod } = (await import('./mod-kit.js')) as ModKitModule
  const events: string[] = []

  const mod = defineMod({
    async setup(_context, _option, scope) {
      scope.own(async () => {
        await Promise.resolve()
        events.push('async-cleaned')
      })
      throw new Error('async setup failed')
    },
  })

  await assert.rejects(
    async () => mod.onContextCreated?.({} as StackchanContext, { config: {} as never }),
    /async setup failed/,
  )
  assert.deepEqual(events, ['async-cleaned'])
})

test('composeFeatures isolates individual feature failures while running remaining features', async () => {
  installAliases()
  const { composeFeatures } = (await import('./mod-kit.js')) as ModKitModule
  const ran: string[] = []
  const errors: string[] = []
  const owned: Array<() => void | Promise<void>> = []

  await composeFeatures(
    { label: 'demo' },
    {
      own(fn) {
        owned.push(fn)
      },
    },
    [
      (deps, scope) => {
        ran.push(`a:${deps.label}`)
        scope.own(() => {
          ran.push('cleanup-a')
        })
        return ok(undefined)
      },
      () => {
        ran.push('b')
        return err('camera-unavailable')
      },
      async () => {
        ran.push('c')
        return ok(undefined)
      },
    ],
    (error) => {
      errors.push(error)
    },
  )

  assert.deepEqual(ran, ['a:demo', 'b', 'c'])
  assert.deepEqual(errors, ['camera-unavailable'])
  assert.equal(owned.length, 1)
})

test('composeFeatures and defineMod complete synchronously when all features are synchronous', async () => {
  installAliases()
  const { composeFeatures, defineMod } = (await import('./mod-kit.js')) as ModKitModule
  const ran: string[] = []

  const mod = defineMod({
    setup(_context, _option, scope) {
      return composeFeatures(
        undefined,
        scope,
        [
          () => {
            ran.push('first')
            return ok(undefined)
          },
          () => {
            ran.push('second')
            return ok(undefined)
          },
        ],
        () => {},
      )
    },
  })

  const result = mod.onContextCreated?.({} as StackchanContext, { config: {} as never })
  assert.equal(result, undefined)
  assert.deepEqual(ran, ['first', 'second'])
})
