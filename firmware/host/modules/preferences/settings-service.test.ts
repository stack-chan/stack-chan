import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { SETTING_KEYS, SETTINGS_SCHEMA, validateSetting } from '../../../sdk/settings-schema.js'
import { writeAliasPackageSubpath } from '../testing/node-alias-package.js'
import type { SettingsIssue, SettingsLayer, SettingsStorage } from './settings-service.js'

const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
writeAliasPackageSubpath(
  modulesRoot,
  'stackchan',
  'settings-schema',
  resolve(modulesRoot, '../../sdk/settings-schema.js'),
)
writeAliasPackageSubpath(modulesRoot, 'stackchan', 'errors', resolve(modulesRoot, '../../sdk/errors.js'))
const { SettingsService } = await import('./settings-service.js')

function fixture(profile: SettingsLayer = {}, app: SettingsLayer = {}, initial: Record<string, unknown> = {}) {
  const stored = new Map(Object.entries(initial))
  const writes: string[] = []
  const issues: SettingsIssue[] = []
  const storage: SettingsStorage = {
    get: (domain, key) => stored.get(`${domain}.${key}`),
    set(domain, key, value) {
      writes.push(`${domain}.${key}`)
      stored.set(`${domain}.${key}`, value)
    },
    delete(domain, key) {
      writes.push(`${domain}.${key}`)
      stored.delete(`${domain}.${key}`)
    },
  }
  const service = new SettingsService({
    profile: () => profile,
    app: () => app,
    storage,
    onIssue: (issue) => issues.push(issue),
  })
  return { service, stored, writes, issues, storage }
}

test('settings resolve default < profile < app < stored and report the effective source', () => {
  const { service, stored } = fixture({ tts: { volume: 0.3 } }, { tts: { volume: 0.4 } }, { 'tts.volume': '0.7' })
  assert.equal(service.get('tts.volume'), 0.7)
  assert.equal(service.describe('tts.volume').source, 'stored')
  stored.delete('tts.volume')
  assert.equal(service.get('tts.volume'), 0.4)
  assert.equal(service.describe('tts.volume').source, 'app')
  assert.equal(fixture({ tts: { volume: 0.3 } }).service.get('tts.volume'), 0.3)
  assert.equal(fixture().service.get('tts.volume'), SETTINGS_SCHEMA['tts.volume'].defaultValue)
})

test('Wi-Fi remains host owned and saved empty credentials override a profile', () => {
  const { service, stored, issues } = fixture(
    { wifi: { ssid: 'profile', password: 'profile-secret' } },
    { wifi: { ssid: 'mod', password: 'mod-secret' } },
  )
  assert.deepEqual(service.domain('wifi'), { ssid: 'profile', password: 'profile-secret' })
  service.write({ 'wifi.ssid': '', 'wifi.password': '' })
  assert.deepEqual(service.domain('wifi'), { ssid: '', password: '' })
  assert.equal(stored.get('wifi.ssid'), '')
  assert.equal(issues.length, 2)
  assert.equal(JSON.stringify(issues).includes('secret'), false)
})

test('a fixed physical driver cannot be replaced by app, storage or a settings batch', () => {
  const { service, writes, issues } = fixture(
    { driver: { type: 'pwm', typeLocked: true } },
    { driver: { type: 'none', typeLocked: false } },
    { 'driver.type': 'scservo' },
  )
  assert.equal(service.get('driver.type'), 'pwm')
  assert.equal(service.describe('driver.type').readOnly, true)
  assert.equal(service.get('driver.type'), 'pwm')
  assert.equal(issues.length, 2)
  assert.throws(() => service.write({ 'tts.volume': 0.8, 'driver.type': 'none' }), { code: 'CONFIG' })
  assert.deepEqual(writes, [])
  for (const type of [undefined, 'invalid']) {
    assert.throws(() => fixture({ driver: { type, typeLocked: true } }).service.get('driver.type'), { code: 'CONFIG' })
  }
})

test('invalid saved values fall back to a valid layer with a redacted diagnostic', () => {
  const { service, issues } = fixture(
    { tts: { volume: 0.2 } },
    { tts: { volume: 0.4 } },
    { 'tts.volume': 'not-a-number-secret' },
  )
  assert.equal(service.get('tts.volume'), 0.4)
  assert.equal(service.describe('tts.volume').source, 'app')
  assert.deepEqual(issues, [{ key: 'tts.volume', source: 'stored', code: 'INVALID' }])
})

test('a batch validates all keys, types and ranges before performing any storage mutation', () => {
  const { service, writes } = fixture()
  for (const invalid of [
    { 'unknown.key': 'secret' },
    { 'tts.port': 1.5 },
    { 'tts.volume': 1.1 },
    { 'ui.type': 'missing' },
    { 'wifi.password': false },
  ]) {
    assert.throws(() => service.write({ 'wifi.ssid': 'new', ...invalid }), { code: 'INVALID_ARGUMENT' })
  }
  assert.deepEqual(writes, [])
})

test('decimal settings survive integer-only NVS and optional resets use provider defaults', () => {
  const { service, stored } = fixture({ tts: { port: 1234 } })
  service.write({ 'tts.volume': '0.375', 'driver.offsetPan': -2.25, 'tts.port': '8080', 'tts.voice': 7 })
  assert.equal(stored.get('tts.volume'), '0.375')
  assert.equal(service.get('tts.volume'), 0.375)
  assert.equal(service.get('driver.offsetPan'), -2.25)
  assert.equal(service.get('tts.voice'), '7')
  service.write({ 'tts.port': '', 'tts.voice': undefined })
  assert.equal(stored.has('tts.port'), false)
  assert.equal(service.get('tts.port'), 1234)
  assert.equal(service.get('tts.voice'), undefined)
  assert.equal(fixture().service.get('tts.speed'), undefined)
})

test('secrets stay available to their host consumer but are absent from descriptions and receipts', () => {
  const { service } = fixture()
  const receipt = service.write({
    'wifi.password': 'wifi-secret',
    'tts.token': 'tts-secret',
    'ai.token': 'ai-secret',
    'chat.apiKey': 'chat-secret',
    'mcp.token': 'mcp-secret',
  })
  for (const key of SETTING_KEYS.filter((key) => SETTINGS_SCHEMA[key].secret)) {
    assert.equal(service.describe(key).value, '')
    assert.equal(service.describe(key).configured, true)
    assert.equal(typeof service.get(key), 'string')
  }
  assert.equal(JSON.stringify(receipt).includes('-secret'), false)
})

test('UTF-8 bounds count bytes and reject NUL and unpaired surrogates', () => {
  assert.equal(validateSetting('wifi.ssid', 'あ'.repeat(10)).valid, true)
  assert.equal(validateSetting('wifi.ssid', 'あ'.repeat(11)).valid, false)
  assert.equal(validateSetting('wifi.ssid', '🤖'.repeat(8)).valid, true)
  assert.equal(validateSetting('wifi.ssid', '\ud800').valid, false)
  assert.equal(validateSetting('wifi.password', 'secret\0tail').valid, false)
  for (const input of ['', ' ', NaN, Infinity, false, null])
    assert.equal(validateSetting('tts.volume', input).valid, false)
})

test('storage failure restores every attempted key, including a write that mutates then throws', () => {
  const { service, stored, storage } = fixture({}, {}, { 'wifi.ssid': 'old', 'wifi.password': 'old-secret' })
  const set = storage.set
  let failed = false
  storage.set = (domain, key, value) => {
    set(domain, key, value)
    if (key === 'password' && !failed) {
      failed = true
      throw new Error('new-secret must not escape')
    }
  }
  assert.throws(() => service.write({ 'wifi.ssid': 'new', 'wifi.password': 'new-secret' }), {
    code: 'IO',
    message: 'Settings could not be saved',
  })
  assert.deepEqual(Object.fromEntries(stored), { 'wifi.ssid': 'old', 'wifi.password': 'old-secret' })
  service.write({ 'wifi.ssid': 'retry' })
  assert.equal(service.get('wifi.ssid'), 'retry')
})

test('failed rollback faults the write boundary until a new host service is created', () => {
  const { service, storage } = fixture()
  storage.set = () => {
    throw new Error('storage')
  }
  storage.delete = () => {
    throw new Error('storage')
  }
  assert.throws(() => service.set('wifi.ssid', 'new'), { code: 'IO' })
  assert.throws(() => service.set('tts.volume', 0.2), {
    code: 'IO',
    message: 'Settings require restart after failed recovery',
  })
})

test('storage read failures are normalized without exposing the storage exception', () => {
  const { service, storage, writes } = fixture()
  storage.get = () => {
    throw new Error('secret from adapter')
  }
  assert.throws(() => service.get('wifi.password'), { code: 'IO', message: 'Settings could not be read' })
  assert.throws(() => service.write({ 'wifi.ssid': 'new' }), { code: 'IO', message: 'Settings could not be read' })
  assert.deepEqual(writes, [])
})
