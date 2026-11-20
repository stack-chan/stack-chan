import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage } from '../../modules/testing/node-alias-package.js'

function installBareSpecifierPackages(): void {
  const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const modulesRoot = resolve(hostRoot, 'modules')

  writeAliasPackage(
    hostRoot,
    'settings-status-model',
    resolve(modulesRoot, 'ui/views/settings/settings-status-model.js'),
  )
  writeAliasPackage(hostRoot, 'localization', resolve(modulesRoot, 'testing/fakes/localization.js'))
  writeAliasPackage(hostRoot, 'volume-model', resolve(modulesRoot, 'preferences/volume-model.js'))
}

async function setup() {
  installBareSpecifierPackages()
  const [{ createInitialSettingsStatus }] = await Promise.all([import('../settings-status.js')])

  return {
    createInitialSettingsStatus,
  }
}

test('settings status shows resolved config.wifi credentials when preferences are not stored', async () => {
  const { createInitialSettingsStatus } = await setup()

  const status = createInitialSettingsStatus({
    wifi: { ssid: 'config-ap', password: 'config-secret' },
  })

  assert.equal(status['wifi.ssid'], 'config-ap')
  assert.equal(status['wifi.password'], 'config-secret')
})

test('settings status normalizes missing Wi-Fi credentials to empty strings', async () => {
  const { createInitialSettingsStatus } = await setup()

  const status = createInitialSettingsStatus({
    wifi: {},
  })

  assert.equal(status['wifi.ssid'], '')
  assert.equal(status['wifi.password'], '')
})

test('settings status exposes the resolved time zone selection', async () => {
  const { createInitialSettingsStatus } = await setup()

  const status = createInitialSettingsStatus({
    wifi: {},
    time: { timezone: 'tokyo' },
  })

  assert.equal(status['time.timezone'], 'tokyo')
})

test('settings status exposes a canonical volume for the on-device slider', async () => {
  const { createInitialSettingsStatus } = await setup()

  const configured = createInitialSettingsStatus({
    wifi: {},
    tts: { volume: 0.456 },
  })
  const fallback = createInitialSettingsStatus({ wifi: {} })

  assert.equal(configured['tts.volume'], 0.46)
  assert.equal(fallback['tts.volume'], 0.5)
})
