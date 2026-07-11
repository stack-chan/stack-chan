import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage } from '../../testing/node-alias-package.js'
import { PreferenceWriteRejection, validatePreferenceWrite } from '../preference-write-guard.js'

type FakePreference = {
  default: {
    get(domain: string, name: string): unknown
  }
  resetPreference(values?: Record<string, unknown>): void
}

type FakeTimer = {
  default: {
    advance(milliseconds: number): void
    reset(): void
  }
}

function installBareSpecifierPackages(): void {
  const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  writeAliasPackage(modulesRoot, 'consts', resolve(modulesRoot, 'preferences/consts.js'))
  writeAliasPackage(modulesRoot, 'preference', resolve(modulesRoot, 'testing/fakes/preference.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackage(
    modulesRoot,
    'preference-write-guard',
    resolve(modulesRoot, 'connectivity/preference-write-guard.js'),
  )
  writeAliasPackage(modulesRoot, 'timer', resolve(modulesRoot, 'testing/fakes/timer.js'), { hasDefaultExport: true })
  writeAliasPackage(modulesRoot, 'uartserver', resolve(modulesRoot, 'connectivity/__tests__/fakes/uartserver.js'))
}

async function setup() {
  installBareSpecifierPackages()
  const [{ PreferenceServer }, { PREF_KEYS }, preference, timer] = await Promise.all([
    import('../preference-server.js'),
    import('../../preferences/consts.js'),
    import('../../testing/fakes/preference.js') as Promise<FakePreference>,
    import('../../testing/fakes/timer.js') as Promise<FakeTimer>,
  ])
  const traces: string[] = []
  ;(globalThis as typeof globalThis & { trace: (...messages: unknown[]) => void }).trace = (...messages) => {
    traces.push(messages.map(String).join(''))
  }
  preference.resetPreference()
  timer.default.reset()
  return { PreferenceServer, PREF_KEYS, preference: preference.default, timer: timer.default, traces }
}

const allowedKeys = [
  ['wifi', 'ssid', String],
  ['wifi', 'password', String],
] as const

test('validatePreferenceWrite accepts whitelisted keys while writes are enabled', () => {
  assert.deepEqual(
    validatePreferenceWrite({
      allowedKeys,
      writesEnabled: true,
      domain: 'wifi',
      key: 'ssid',
    }),
    { allowed: true },
  )
})

test('validatePreferenceWrite rejects unknown domains', () => {
  assert.deepEqual(
    validatePreferenceWrite({
      allowedKeys,
      writesEnabled: true,
      domain: 'secrets',
      key: 'token',
    }),
    { allowed: false, reason: PreferenceWriteRejection.UNKNOWN_PREFERENCE },
  )
})

test('validatePreferenceWrite rejects writes while the write window is closed', () => {
  assert.deepEqual(
    validatePreferenceWrite({
      allowedKeys,
      writesEnabled: false,
      domain: 'wifi',
      key: 'ssid',
    }),
    { allowed: false, reason: PreferenceWriteRejection.WRITES_DISABLED },
  )
})

test('PreferenceServer rejects BLE preference writes until the write window is opened', async () => {
  const { PreferenceServer, PREF_KEYS, preference, traces } = await setup()
  let changed = false
  const server = new PreferenceServer({
    keys: PREF_KEYS,
    onPreferenceChanged: () => {
      changed = true
    },
  })

  server.receiveAndSetPreference('wifi', 'ssid', 'stackchan-ap')

  assert.equal(preference.get('wifi', 'ssid'), undefined)
  assert.equal(changed, false)
  assert.ok(traces.includes('rejected BLE preference write (writes-disabled): wifi.ssid\n'))
})

test('PreferenceServer accepts whitelisted BLE preference writes while the write window is open', async () => {
  const { PreferenceServer, PREF_KEYS, preference } = await setup()
  const changes: Array<{ key: string; value: unknown }> = []
  const server = new PreferenceServer({
    keys: PREF_KEYS,
    onPreferenceChanged: (key: string, value: unknown) => changes.push({ key, value }),
  })

  server.enableWrites()
  server.receiveAndSetPreference('wifi', 'ssid', 'stackchan-ap')

  assert.equal(preference.get('wifi', 'ssid'), 'stackchan-ap')
  assert.deepEqual(changes, [{ key: 'wifi.ssid', value: 'stackchan-ap' }])
})

test('PreferenceServer rejects non-whitelisted preference keys even while writes are enabled', async () => {
  const { PreferenceServer, PREF_KEYS, preference, traces } = await setup()
  const server = new PreferenceServer({ keys: PREF_KEYS })

  server.enableWrites()
  server.receiveAndSetPreference('wifi', 'evil', 'stackchan-ap')

  assert.equal(preference.get('wifi', 'evil'), undefined)
  assert.ok(traces.includes('rejected BLE preference write (unknown-preference): wifi.evil\n'))
})

test('PreferenceServer closes the BLE preference write window after the requested duration', async () => {
  const { PreferenceServer, PREF_KEYS, preference, timer, traces } = await setup()
  const server = new PreferenceServer({ keys: PREF_KEYS })

  server.enableWrites(1000)
  server.receiveAndSetPreference('wifi', 'ssid', 'first-ap')
  timer.advance(1000)
  server.receiveAndSetPreference('wifi', 'password', 'secret')

  assert.equal(preference.get('wifi', 'ssid'), 'first-ap')
  assert.equal(preference.get('wifi', 'password'), undefined)
  assert.ok(traces.includes('BLE preference write window closed\n'))
  assert.ok(traces.includes('rejected BLE preference write (writes-disabled): wifi.password\n'))
})
