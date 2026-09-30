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
