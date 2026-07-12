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

  // Piu view construction belongs to the view layer; on-launch orchestrates.
  assert.doesNotMatch(launchSource, /new Container/)
  assert.doesNotMatch(launchSource, /new Column/)
  assert.doesNotMatch(launchSource, /new Label/)
  assert.doesNotMatch(launchSource, /new Skin/)
  assert.doesNotMatch(launchSource, /new Style/)
  assert.doesNotMatch(launchSource, /globalThis\.button/)
})
