import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage, writeAliasPackageSubpath } from '../../modules/testing/node-alias-package.js'

type StartupChoiceModule = typeof import('app-default-behavior/startup-choice')
type WasmOnLaunchModule = typeof import('app-default-behavior/wasm/on-launch')

type TimerHandle = {
  active: boolean
  callback: () => void
  interval: number
}

type ManualTimer = {
  handles: TimerHandle[]
  clearCalls: unknown[]
  set(callback: () => void, interval?: number): TimerHandle
  clear(handle: unknown): void
  fire(handle: TimerHandle): void
}

type FakeTimer = {
  advance(milliseconds: number): void
  reset(): void
}

type StartupSplashStub = {
  resetStartupSplashCalls(): void
  startupSplashCallCount(): number
  pressStartupMods(): void
  pressStartupSettings(): void
}

type SetupModeStub = {
  resetSetupModeCalls(): void
  startedSetupModeApplications(): unknown[]
  finishSetupMode(choice: 'back' | 'boot'): void
}

function createManualTimer(): ManualTimer {
  const timer: ManualTimer = {
    handles: [],
    clearCalls: [],
    set(callback, interval = 0) {
      const handle = { active: true, callback, interval }
      timer.handles.push(handle)
      return handle
    },
    clear(handle) {
      assert.notEqual(handle, undefined)
      timer.clearCalls.push(handle)
      if (typeof handle === 'object' && handle != null && 'active' in handle) {
        ;(handle as TimerHandle).active = false
      }
    },
    fire(handle) {
      if (!handle.active) return
      handle.active = false
      handle.callback()
    },
  }
  return timer
}

function installBareSpecifierPackages(): void {
  const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const appRoot = resolve(hostRoot, 'app')

  writeAliasPackageSubpath(
    hostRoot,
    'app-default-behavior',
    'startup-choice',
    resolve(appRoot, 'default-behavior/startup-choice.js'),
  )
  writeAliasPackageSubpath(
    hostRoot,
    'app-default-behavior',
    'wasm/on-launch',
    resolve(appRoot, 'default-behavior/wasm/on-launch.js'),
  )
  writeAliasPackage(hostRoot, 'timer', resolve(hostRoot, 'modules/testing/fakes/timer.js'), { hasDefaultExport: true })
  writeAliasPackage(
    hostRoot,
    'startup-splash',
    resolve(appRoot, 'default-behavior/__tests__/startup-choice/startup-splash-stub.js'),
  )
  writeAliasPackage(
    hostRoot,
    'setup-mode',
    resolve(appRoot, 'default-behavior/__tests__/startup-choice/setup-mode-stub.js'),
  )
}

test('startup choice automatically boots after the configured delay', async () => {
  installBareSpecifierPackages()
  const { STARTUP_AUTO_BOOT_DELAY_MS, waitForStartupChoice } = (await import(
    'app-default-behavior/startup-choice'
  )) as StartupChoiceModule
  const timer = createManualTimer()
  const application = { id: 'startup-application' }

  const choice = waitForStartupChoice({
    timer,
    showStartupSplash: () => application as never,
  })

  assert.equal(timer.handles.length, 1)
  assert.equal(timer.handles[0].interval, STARTUP_AUTO_BOOT_DELAY_MS)

  timer.fire(timer.handles[0])

  assert.deepEqual(await choice, { choice: 'boot', application })
  assert.equal(timer.handles[0].active, false)
  assert.deepEqual(timer.clearCalls, [timer.handles[0]])
})

test('startup choice enters settings when the visible settings action is pressed', async () => {
  installBareSpecifierPackages()
  const { waitForStartupChoice } = (await import('app-default-behavior/startup-choice')) as StartupChoiceModule
  const timer = createManualTimer()
  const application = { id: 'startup-application' }
  let onSettings: (() => void) | undefined

  const choice = waitForStartupChoice({
    timer,
    showStartupSplash: (options) => {
      onSettings = options.onSettings
      return application as never
    },
  })

  onSettings?.()

  assert.equal(timer.handles.length, 2)
  assert.equal(timer.handles[1].interval, 0)

  timer.fire(timer.handles[1])

  assert.deepEqual(await choice, { choice: 'settings', application })
  assert.equal(timer.handles[0].active, false)
  assert.equal(timer.handles[1].active, false)
})

test('startup choice enters the MOD manager when its action is enabled', async () => {
  installBareSpecifierPackages()
  const { waitForStartupChoice } = (await import('app-default-behavior/startup-choice')) as StartupChoiceModule
  const timer = createManualTimer()
  const application = { id: 'startup-application' }
  let onMods: (() => void) | undefined

  const choice = waitForStartupChoice({
    timer,
    enableMods: true,
    showStartupSplash: (options) => {
      onMods = options.onMods
      return application as never
    },
  })

  onMods?.()
  timer.fire(timer.handles[1])

  assert.deepEqual(await choice, { choice: 'mods', application })
  assert.equal(timer.handles[0].active, false)
  assert.equal(timer.handles[1].active, false)
})

test('startup choice resolves only once and ignores later timer callbacks', async () => {
  installBareSpecifierPackages()
  const { waitForStartupChoice } = (await import('app-default-behavior/startup-choice')) as StartupChoiceModule
  const timer = createManualTimer()
  const application = { id: 'startup-application' }
  let onSettings: (() => void) | undefined
  const observed: unknown[] = []

  const choice = waitForStartupChoice({
    timer,
    showStartupSplash: (options) => {
      onSettings = options.onSettings
      return application as never
    },
  })
  choice.then((result) => observed.push(result))

  onSettings?.()
  timer.fire(timer.handles[1])
  timer.fire(timer.handles[0])
  timer.fire(timer.handles[1])
  await choice
  await Promise.resolve()

  assert.deepEqual(observed, [{ choice: 'settings', application }])
})

test('wasm onLaunch shows the startup splash and resolves after the visible delay', async () => {
  installBareSpecifierPackages()
  const [{ onLaunch }, { default: timer }, startupSplash, setupMode] = await Promise.all([
    import('app-default-behavior/wasm/on-launch') as Promise<WasmOnLaunchModule>,
    import('timer') as Promise<{ default: FakeTimer }>,
    import('startup-splash') as Promise<StartupSplashStub>,
    import('setup-mode') as Promise<SetupModeStub>,
  ])
  timer.reset()
  startupSplash.resetStartupSplashCalls()
  setupMode.resetSetupModeCalls()

  let resolved = false
  const result = onLaunch()
  result.then(() => {
    resolved = true
  })

  assert.equal(startupSplash.startupSplashCallCount(), 1)

  timer.advance(7999)
  await Promise.resolve()
  assert.equal(resolved, false)

  timer.advance(1)

  assert.equal(await result, true)
  assert.deepEqual(setupMode.startedSetupModeApplications(), [])
})

test('wasm onLaunch boots after setup is explicitly finished', async () => {
  installBareSpecifierPackages()
  const [{ onLaunch }, { default: timer }, startupSplash, setupMode] = await Promise.all([
    import('app-default-behavior/wasm/on-launch') as Promise<WasmOnLaunchModule>,
    import('timer') as Promise<{ default: FakeTimer }>,
    import('startup-splash') as Promise<StartupSplashStub>,
    import('setup-mode') as Promise<SetupModeStub>,
  ])
  timer.reset()
  startupSplash.resetStartupSplashCalls()
  setupMode.resetSetupModeCalls()

  const result = onLaunch()
  startupSplash.pressStartupSettings()
  timer.advance(0)
  await Promise.resolve()

  assert.deepEqual(setupMode.startedSetupModeApplications(), [{ type: 'startup-splash' }])
  setupMode.finishSetupMode('boot')
  assert.equal(await result, true)
})

test('wasm onLaunch returns to a fresh splash when setup goes back', async () => {
  installBareSpecifierPackages()
  const [{ onLaunch }, { default: timer }, startupSplash, setupMode] = await Promise.all([
    import('app-default-behavior/wasm/on-launch') as Promise<WasmOnLaunchModule>,
    import('timer') as Promise<{ default: FakeTimer }>,
    import('startup-splash') as Promise<StartupSplashStub>,
    import('setup-mode') as Promise<SetupModeStub>,
  ])
  timer.reset()
  startupSplash.resetStartupSplashCalls()
  setupMode.resetSetupModeCalls()

  const result = onLaunch()
  startupSplash.pressStartupSettings()
  timer.advance(0)
  await Promise.resolve()
  setupMode.finishSetupMode('back')
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(startupSplash.startupSplashCallCount(), 2)
  timer.advance(8000)
  assert.equal(await result, true)
})
