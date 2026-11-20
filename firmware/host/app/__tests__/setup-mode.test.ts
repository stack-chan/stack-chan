import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage, writeAliasPackageSubpath } from '../../modules/testing/node-alias-package.js'

function installAliases(): void {
  const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const modulesRoot = resolve(appRoot, '../modules')
  const shared = [
    ['consts', 'preferences/consts.js'],
    ['preference-write-guard', 'connectivity/preference-write-guard.js'],
    ['localization', 'testing/fakes/localization.js'],
    ['network-manager', 'connectivity/__tests__/fakes/network-manager.js'],
    ['uartserver', 'connectivity/__tests__/fakes/uartserver.js'],
    ['timezone-model', 'preferences/timezone-model.js'],
    ['volume-model', 'preferences/volume-model.js'],
    ['settings-status-model', 'ui/views/settings/settings-status-model.js'],
  ]
  const sharedDefault = [
    ['preference', 'testing/fakes/preference.js'],
    ['structuredClone', 'testing/fakes/structured-clone.js'],
    ['modules', 'testing/fakes/modules.js'],
    ['timer', 'testing/fakes/timer.js'],
    ['time', 'testing/fakes/time.js'],
    ['ecma-wifi', 'connectivity/__tests__/fakes/ecma-wifi.js'],
  ]
  for (const root of [appRoot, modulesRoot]) {
    for (const [name, path] of shared) writeAliasPackage(root, name, resolve(modulesRoot, path))
    for (const [name, path] of sharedDefault) {
      writeAliasPackage(root, name, resolve(modulesRoot, path), { hasDefaultExport: true })
    }
    writeAliasPackageSubpath(root, 'mc', 'config', resolve(modulesRoot, 'testing/fakes/mc-config.js'), {
      hasDefaultExport: true,
    })
  }
  for (const [name, path] of [
    ['loadPreference', 'preferences/loadPreference.js'],
    ['network-state', 'connectivity/network-state.js'],
    ['preference-server', 'connectivity/preference-server.js'],
    ['settings-network-list', 'ui/views/settings/settings-network-list.js'],
    ['stored-wifi', 'connectivity/stored-wifi.js'],
    ['timezone-settings', 'preferences/timezone-settings.js'],
    ['wifi-scan', 'connectivity/wifi-scan.js'],
  ])
    writeAliasPackage(appRoot, name, resolve(modulesRoot, path))
  for (const [name, path] of [
    ['settings-status', 'settings-status.js'],
    ['settings-view', '__tests__/fakes/settings-view.js'],
    ['volume-preview', 'volume-preview.js'],
  ])
    writeAliasPackage(appRoot, name, resolve(appRoot, path))
  writeAliasPackage(appRoot, 'speaker', resolve(appRoot, '__tests__/fakes/settings-speaker.js'), {
    hasDefaultExport: true,
  })
}

async function setup() {
  installAliases()
  const traces: string[] = []
  ;(globalThis as typeof globalThis & { trace: (...messages: unknown[]) => void }).trace = (...messages) => {
    traces.push(messages.map(String).join(''))
  }
  const [setupMode, view, speaker, preference, timer, uart, network, config] = await Promise.all([
    import('../setup-mode.js'),
    import('./fakes/settings-view.js'),
    import('./fakes/settings-speaker.js'),
    import('../../modules/testing/fakes/preference.js'),
    import('../../modules/testing/fakes/timer.js'),
    import('../../modules/connectivity/__tests__/fakes/uartserver.js'),
    import('../../modules/connectivity/__tests__/fakes/network-manager.js'),
    import('../../modules/testing/fakes/mc-config.js'),
  ])
  const time = (await import('../../modules/testing/fakes/time.js')).default
  time.reset()
  function advance(ms: number) {
    time.setTicks(time.ticks + ms)
    timer.default.advance(ms)
  }
  config.resetConfig({ tts: { volume: 0.5 } })
  preference.resetPreference()
  timer.default.reset()
  network.resetNetworkManager()
  view.resetSettingsViews()
  speaker.speakers.length = 0
  const contents: unknown[] = []
  const application = {
    empty: () => {
      contents.length = 0
    },
    add: (content: unknown) => {
      contents.push(content)
    },
  }
  return {
    ...setupMode,
    view,
    speaker,
    preference: preference.default,
    timer: timer.default,
    advance,
    uart,
    network,
    application,
    contents,
    traces,
  }
}

for (const action of ['exit', 'boot'] as const) {
  test(`Settings survives BLE timer allocation failure and completes ${action} cleanup`, async () => {
    const context = await setup()
    const { startSetupMode, application, timer, view, uart, speaker, preference, network, traces } = context
    const originalSet = timer.set
    let allocationAttempts = 0
    timer.set = () => {
      allocationAttempts += 1
      throw new Error('add failed')
    }
    let result: ReturnType<typeof startSetupMode>
    try {
      result = startSetupMode(application)
    } finally {
      timer.set = originalSet
    }
    const settlement: { state: string; error?: unknown } = { state: 'pending' }
    void result.then(
      () => {
        settlement.state = 'resolved'
      },
      (error: unknown) => {
        settlement.state = 'rejected'
        settlement.error = error
      },
    )
    await Promise.resolve()
    assert.equal(settlement.state, 'pending', String(settlement.error))
    assert.equal(allocationAttempts, 1)
    assert.ok(traces.some((message) => message.includes('BLE preference writes unavailable')))
    assert.ok(view.lastContext)
    assert.equal(context.contents.length, 1)
    const server = uart.lastUARTServer as InstanceType<
      typeof import('../../modules/connectivity/preference-server.js')['PreferenceServer']
    >
    assert.equal(server.closed, false)
    server.receiveAndSetPreference('wifi', 'ssid', 'remote-write')
    assert.equal(preference.get('wifi', 'ssid'), undefined)

    // Local controls still work, and preview playback is owned until normal exit completes.
    view.lastContext.actions.navigate(view.SettingsViewId.VOLUME)
    assert.equal(view.views[0].disposals, 1)
    view.lastContext.actions.saveVolume(0.7)
    await Promise.resolve()
    assert.equal(Number(preference.get('tts', 'volume')), 0.7)
    assert.equal(speaker.speakers[0].tones.length, 1)
    view.lastContext.actions[action]()
    view.lastContext.actions[action]()
    assert.equal(view.views[1].disposals, 1)
    assert.equal(server.closed, true)
    assert.equal(network.getStopCount(), action === 'exit' ? 1 : 0)
    await Promise.resolve()
    assert.equal(settlement.state, 'pending')
    speaker.speakers[0].finishTone()
    assert.equal(await result, action === 'exit' ? 'back' : 'boot')
    server.receiveAndSetPreference('wifi', 'ssid', 'after-exit')
    assert.equal(preference.get('wifi', 'ssid'), undefined)
    assert.equal(allocationAttempts, 1)
  })
}

// Exercise the real Settings controller with fake platform resources only.
function wire(value: unknown): ArrayBuffer {
  ;(String as typeof String & { fromArrayBuffer(value: ArrayBuffer): string }).fromArrayBuffer = (value) =>
    new TextDecoder().decode(value)
  ;(ArrayBuffer as typeof ArrayBuffer & { fromString(value: string): ArrayBuffer }).fromString = (value) =>
    new TextEncoder().encode(value).buffer as ArrayBuffer
  return new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).buffer as ArrayBuffer
}

function liveServer(context: Awaited<ReturnType<typeof setup>>) {
  return context.uart.lastUARTServer as InstanceType<
    typeof import('../../modules/connectivity/preference-server.js')['PreferenceServer']
  >
}

for (const action of ['exit', 'boot'] as const) {
  test(`normal Settings ${action} closes a live window, drops fragments and permits a fresh session`, async () => {
    const context = await setup()
    const { startSetupMode, application, view, preference, advance, network } = context
    preference.set('tts', 'volume', '0.20')
    const result = startSetupMode(application)
    const first = liveServer(context)
    first.onRX(wire({ prop: 'tts.volume', value: '0.21' }))
    assert.equal(preference.get('tts', 'volume'), '0.21')
    assert.equal(view.lastContext?.state.volume, 0.21)

    // Returning from Volume only navigates; it must not end the opt-in window.
    view.lastContext?.actions.navigate(view.SettingsViewId.VOLUME)
    view.lastContext?.actions.navigate(view.SettingsViewId.MENU)
    first.onRX(wire({ prop: 'tts.volume', value: '0.20' }))
    assert.equal(preference.get('tts', 'volume'), '0.2')
    first.onRX(wire('{"prop":"tts.volume","value":'))
    const previousView = view.views.at(-1)
    view.lastContext?.actions[action]()
    view.lastContext?.actions[action]()
    assert.equal(first.closed, true)
    assert.equal(previousView?.disposals, 1)
    assert.equal(await result, action === 'exit' ? 'back' : 'boot')
    assert.equal(network.getStopCount(), action === 'exit' ? 1 : 0)

    // The window is still far from expiry: this isolates exit cleanup from time.
    first.onRX(wire('"0.22"}'))
    first.onRX(wire({ _batch: { 'tts.volume': '0.22' } }))
    first.receiveAndSetPreference('tts', 'volume', '0.22')
    assert.equal(preference.get('tts', 'volume'), '0.2')
    assert.equal(view.lastContext?.state.volume, 0.2)

    // Reentry has its own live window. Old fragments and timers cannot corrupt it.
    advance(10)
    const freshResult = startSetupMode(application)
    const fresh = liveServer(context)
    assert.notEqual(fresh, first)
    fresh.onRX(wire('"0.23"}'))
    advance(3000)
    assert.equal(preference.get('tts', 'volume'), '0.2')
    fresh.onRX(wire({ prop: 'tts.volume', value: '0.21' }))
    assert.equal(preference.get('tts', 'volume'), '0.21')
    advance(300000 - 3010)
    fresh.onRX(wire({ prop: 'tts.volume', value: '0.20' }))
    assert.equal(preference.get('tts', 'volume'), '0.2', 'old session deadline must not close the fresh session')
    advance(10)
    fresh.onRX(wire({ prop: 'tts.volume', value: '0.22' }))
    assert.equal(preference.get('tts', 'volume'), '0.2', 'fresh session deadline must still expire')
    first.enableWrites(300000)
    first.onDisconnected()
    first.onRX(wire({ prop: 'tts.volume', value: '0.22' }))
    assert.equal(preference.get('tts', 'volume'), '0.2')
    assert.equal(first.advertisingStarts.length, 0)
    view.lastContext?.actions.exit()
    assert.equal(await freshResult, 'back')
  })
}

test('actual Settings starts the five-minute clock once; reconnect cannot renew or complete stale fragments', async () => {
  const context = await setup()
  const { startSetupMode, application, view, preference, advance } = context
  preference.set('tts', 'volume', '0.20')
  const result = startSetupMode(application)
  const server = liveServer(context)
  advance(300000 - 2)
  server.onRX(wire('{"prop":"tts.volume","value":'))
  server.onDisconnected()
  server.onConnected()
  server.onRX(wire('"0.22"}'))
  assert.equal(preference.get('tts', 'volume'), '0.20')
  // Dispose of the incomplete suffix, then a clean write just before expiry.
  server.onDisconnected()
  server.onConnected()
  advance(1)
  server.onRX(wire({ prop: 'tts.volume', value: '0.21' }))
  assert.equal(preference.get('tts', 'volume'), '0.21')
  server.onRX(wire('{"prop":"tts.volume","value":'))
  advance(1)
  server.onRX(wire('"0.22"}'))
  server.onRX(wire({ _batch: { 'tts.volume': '0.22' } }))
  server.receiveAndSetPreference('tts', 'volume', '0.22')
  assert.equal(preference.get('tts', 'volume'), '0.21')
  assert.equal(view.lastContext?.state.volume, 0.21)
  view.lastContext?.actions.exit()
  assert.equal(await result, 'back')
})

test('actual Settings wires platform driver lock into readOnly notifications and preserves stored driver', async () => {
  const context = await setup()
  const config = await import('../../modules/testing/fakes/mc-config.js')
  config.resetConfig({ driver: { type: 'm5stackchan', typeLocked: true }, tts: { volume: 0.2 } })
  context.preference.set('driver', 'type', 'scservo')
  context.preference.set('tts', 'volume', '0.20')
  const result = context.startSetupMode(context.application)
  const server = liveServer(context)
  wire('') // Install ArrayBuffer/String helpers before fake notifications.
  server.onCharacteristicNotifyEnabled({ name: 'tx' })
  const payloads = () => server.notifications.map(({ value }) => JSON.parse(new TextDecoder().decode(value)))
  assert.deepEqual(
    payloads().find((value) => value.prop === 'driver.type'),
    {
      prop: 'driver.type',
      value: 'm5stackchan',
      readOnly: true,
    },
  )
  server.onRX(wire({ prop: 'driver.type', value: 'dynamixel' }))
  server.onRX(wire({ _batch: { 'driver.type': 'pwm', 'tts.volume': '0.21' } }))
  assert.equal(context.preference.get('driver', 'type'), 'scservo')
  assert.equal(context.preference.get('tts', 'volume'), '0.21')
  const driverReplies = payloads().filter((value) => value.prop === 'driver.type')
  assert.equal(driverReplies.length, 3)
  for (const reply of driverReplies) {
    assert.deepEqual(reply, { prop: 'driver.type', value: 'm5stackchan', readOnly: true })
  }
  context.view.lastContext?.actions.boot()
  assert.equal(await result, 'boot')
  assert.equal(server.closed, true)
  assert.equal(context.preference.get('driver', 'type'), 'scservo')
})

for (const action of ['exit', 'boot'] as const) {
  test(`Settings ${action} disposal denies fragments across elapsed expiry without Timer delivery`, async () => {
    const context = await setup()
    const { startSetupMode, application, view, preference, network } = context
    const time = (await import('../../modules/testing/fakes/time.js')).default
    preference.set('tts', 'volume', '0.2')
    const result = startSetupMode(application)
    const server = liveServer(context)
    server.onRX(wire({ prop: 'tts.volume', value: '0.21' }))
    server.onRX(wire({ prop: 'tts.volume', value: '0.2' }))
    time.setTicks(300000 - 1)
    server.onRX(wire('{"prop":"tts.volume","value":'))
    const current = view.views.at(-1)
    assert.ok(current)
    const originalDispose = current.dispose
    current.dispose = () => {
      time.setTicks(300000)
      server.onRX(wire('"0.22"}'))
      originalDispose()
    }
    view.lastContext?.actions[action]()
    view.lastContext?.actions[action]()
    assert.equal(await result, action === 'exit' ? 'back' : 'boot')
    assert.equal(current.disposals, 1)
    assert.equal(server.closed, true)
    assert.equal(preference.get('tts', 'volume'), '0.2')
    assert.equal(network.getStopCount(), action === 'exit' ? 1 : 0)

    const freshResult = startSetupMode(application)
    const fresh = liveServer(context)
    fresh.onRX(wire({ prop: 'tts.volume', value: '0.21' }))
    server.receiveAndSetPreference('tts', 'volume', '0.22')
    assert.equal(preference.get('tts', 'volume'), '0.21')
    assert.equal(view.lastContext?.state.volume, 0.21)
    view.lastContext?.actions.boot()
    assert.equal(await freshResult, 'boot')
  })
}
