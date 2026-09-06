import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// Imports are the maintained layer boundary; view behavior is checked in XS.
function imports(path: string): Set<string> {
  return new Set([...readFileSync(path, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]))
}

test('host startup owns setup, and Piu construction stays in the settings view layer', () => {
  const host = imports('host/app/app-main.ts')
  const setup = imports('host/app/setup-mode.ts')
  const app = imports('host/app/default-behavior/behavior.ts')
  assert.ok(host.has('host-startup'))
  assert.ok(host.has('setup-mode'))
  assert.ok(setup.has('settings-view'))
  for (const dependency of ['host-startup', 'setup-mode', 'startup-splash'])
    assert.equal(app.has(dependency), false, `default app must not own ${dependency}`)
  for (const layer of [host, setup])
    for (const dependency of ['piu/MC', 'ui-controls', 'ui-theme'])
      assert.equal(layer.has(dependency), false, `orchestration must not construct views through ${dependency}`)
})
