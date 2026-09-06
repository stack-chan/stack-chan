import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type HostStartupOptions, runHostStartup } from '../host-startup.js'

function fixture() {
  let now = 0
  let nextId = 0
  const timers = new Map<number, { at: number; callback(): void }>()
  const screens: { actions: Parameters<HostStartupOptions<number>['showSplash']>[0]; application: number }[] = []
  const settings: { application: number; finish(choice: 'back' | 'boot'): void }[] = []
  const options: HostStartupOptions<number> = {
    timer: {
      set(callback, delay = 0) {
        timers.set(++nextId, { at: now + delay, callback })
        return nextId
      },
      clear(handle) {
        timers.delete(handle as number)
      },
    },
    showSplash(actions) {
      const application = screens.length + 1
      screens.push({ actions, application })
      return application
    },
    openSettings(application) {
      return new Promise((finish) => settings.push({ application, finish }))
    },
  }
  return {
    options,
    timers,
    screens,
    settings,
    async advance(ms: number) {
      now += ms
      for (const [id, timer] of [...timers]) {
        if (timer.at > now || !timers.delete(id)) continue
        timer.callback()
      }
      await Promise.resolve()
    },
  }
}

test('host startup keeps the native and configured simulator splash delays', async () => {
  for (const delay of [undefined, 8000]) {
    const f = fixture()
    f.options.autoBootDelayMs = delay
    const result = runHostStartup(f.options)
    let finished = false
    void result.then(() => (finished = true))
    assert.equal(f.screens.length, 1)
    assert.equal(f.screens[0].actions.onMods, undefined)
    await f.advance((delay ?? 3000) - 1)
    assert.equal(finished, false)
    await f.advance(1)
    assert.equal(await result, true)
    assert.equal(f.settings.length, 0)
    assert.equal(f.timers.size, 0)
    f.screens[0].actions.onSettings()
    assert.equal(f.timers.size, 0, 'a retired splash cannot schedule work')
  }
})

test('settings suspends auto boot, coalesces taps, and boots only after explicit completion', async () => {
  const f = fixture()
  const result = runHostStartup(f.options)
  const { actions, application } = f.screens[0]
  actions.onSettings()
  actions.onSettings()
  assert.equal(f.timers.size, 1)
  assert.equal(f.settings.length, 0, 'switch views outside the touch callback')
  await f.advance(0)
  assert.equal(f.settings.length, 1)
  assert.equal(f.settings[0].application, application)
  assert.equal(f.timers.size, 0)
  await f.advance(8000)
  f.settings[0].finish('boot')
  assert.equal(await result, true)
})

test('100 settings/back cycles release timers and ignore callbacks from earlier screens', async () => {
  const f = fixture()
  const result = runHostStartup(f.options)
  for (let i = 0; i < 100; i++) {
    const previous = f.screens[i]
    previous.actions.onSettings()
    await f.advance(0)
    assert.equal(f.timers.size, 0)
    f.settings[i].finish('back')
    await Promise.resolve()
    assert.equal(f.screens.length, i + 2)
    assert.equal(f.timers.size, 1)
    previous.actions.onSettings()
    assert.equal(f.timers.size, 1)
  }
  await f.advance(3000)
  assert.equal(await result, true)
  assert.equal(f.timers.size, 0)
})

test('maintenance wins once and stops normal boot without opening settings', async () => {
  const f = fixture()
  let restarts = 0
  f.options.openMods = () => restarts++
  const result = runHostStartup(f.options)
  const actions = f.screens[0].actions
  actions.onMods?.()
  actions.onSettings()
  actions.onMods?.()
  assert.equal(restarts, 0)
  await f.advance(0)
  assert.equal(await result, false)
  assert.equal(restarts, 1)
  assert.equal(f.settings.length, 0)
  assert.equal(f.timers.size, 0)
  actions.onMods?.()
  assert.equal(f.timers.size, 0)
})

test('setup and maintenance failures propagate after their splash timers are released', async () => {
  for (const mode of ['settings', 'mods'] as const) {
    const f = fixture()
    const failure = new Error(mode)
    f.options.openMods = () => {
      throw failure
    }
    f.options.openSettings = async () => {
      throw failure
    }
    const result = runHostStartup(f.options)
    const rejected = assert.rejects(result, (error) => error === failure)
    if (mode === 'mods') f.screens[0].actions.onMods?.()
    else f.screens[0].actions.onSettings()
    await f.advance(0)
    await rejected
    assert.equal(f.timers.size, 0)
  }
})

test('failure to schedule a transition rejects startup and disables stale actions', async () => {
  const f = fixture()
  const result = runHostStartup(f.options)
  const failure = new Error('timer unavailable')
  f.options.timer.set = () => {
    throw failure
  }
  const rejected = assert.rejects(result, (error) => error === failure)
  f.screens[0].actions.onSettings()
  await rejected
  assert.equal(f.timers.size, 0)
  f.screens[0].actions.onSettings()
  assert.equal(f.settings.length, 0)
})
