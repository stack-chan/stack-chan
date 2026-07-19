import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const defaultLaunchPath = 'host/app/default-behavior/on-launch.ts'
const setupModePath = 'host/app/setup-mode.ts'

test('default launch behavior reaches the settings screen only through setup-mode', () => {
  const launchSource = readFileSync(defaultLaunchPath, 'utf8')
  const setupModeSource = readFileSync(setupModePath, 'utf8')

  assert.doesNotMatch(launchSource, /from 'settings-view'/)
  assert.match(launchSource, /from 'setup-mode'/)
  assert.match(setupModeSource, /from 'settings-view'/)
  assert.match(setupModeSource, /settingsViews\[id\]\.create\(viewContext\)/)
  assert.doesNotMatch(setupModeSource, /buildSettings(?:Menu|Password|Wifi)?View/)
  assert.doesNotMatch(setupModeSource, /SettingsStatusLabels/)
  assert.doesNotMatch(setupModeSource, /updateSettings(?:Network|Status)/)

  // Piu view construction belongs to the view layer; on-launch orchestrates.
  for (const source of [launchSource, setupModeSource]) {
    assert.doesNotMatch(source, /new Container/)
    assert.doesNotMatch(source, /new Column/)
    assert.doesNotMatch(source, /new Label/)
    assert.doesNotMatch(source, /new Skin/)
    assert.doesNotMatch(source, /new Style/)
  }
  assert.doesNotMatch(launchSource, /globalThis\.button/)
})
