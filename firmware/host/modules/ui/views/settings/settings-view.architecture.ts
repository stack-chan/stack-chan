import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const settingsViewPath = 'host/modules/ui/views/settings/settings-view.ts'
const defaultLaunchPath = 'host/app/default-behavior/on-launch.ts'
const setupModePath = 'host/app/setup-mode.ts'

test('settings view owns the Piu setup screen construction', () => {
  const settingsSource = readFileSync(settingsViewPath, 'utf8')
  const launchSource = readFileSync(defaultLaunchPath, 'utf8')
  const setupModeSource = readFileSync(setupModePath, 'utf8')
  const uiManifest = JSON.parse(readFileSync('host/modules/ui/manifest.json', 'utf8'))
  const wasmUiManifest = JSON.parse(readFileSync('host/modules/ui/manifest_wasm.json', 'utf8'))

  assert.match(settingsSource, /export const buildSettingsView/)
  assert.match(settingsSource, /export const updateSettingsStatusLabels/)
  assert.match(settingsSource, /new Container/)
  assert.match(settingsSource, /new Column/)
  assert.match(settingsSource, /new Label/)
  assert.match(settingsSource, /Stack-chan Setup/)
  assert.match(settingsSource, /Tap to test connection/)
  assert.match(settingsSource, /onTouchEnded/)

  assert.doesNotMatch(launchSource, /from 'settings-view'/)
  assert.doesNotMatch(launchSource, /buildSettingsView/)
  assert.doesNotMatch(launchSource, /updateSettingsStatusLabels/)
  assert.match(launchSource, /from '\.\.\/setup-mode'/)
  assert.match(setupModeSource, /from 'settings-view'/)
  assert.match(setupModeSource, /buildSettingsView/)
  assert.match(setupModeSource, /updateSettingsStatusLabels/)
  assert.doesNotMatch(launchSource, /new Container/)
  assert.doesNotMatch(launchSource, /new Column/)
  assert.doesNotMatch(launchSource, /new Label/)
  assert.doesNotMatch(launchSource, /new Skin/)
  assert.doesNotMatch(launchSource, /new Style/)
  assert.doesNotMatch(launchSource, /globalThis\.button/)

  assert.equal(uiManifest.modules['settings-view'], './views/settings/settings-view')
  assert.equal(wasmUiManifest.modules['settings-view'], './views/settings/settings-view')
})
