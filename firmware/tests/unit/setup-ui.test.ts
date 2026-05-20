import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  createSetupState,
  getWasmFakeNetworks,
  maskPassword,
  reducePasswordInput,
  selectNetwork,
  signalStrengthForRssi,
} from '../../stackchan/setup-ui-model.js'

describe('setup ui model', () => {
  test('setup UI reuses Moddable wifi-config list and horizontal expanding keyboard patterns', () => {
    const source = readFileSync('stackchan/setup-ui.ts', 'utf8')
    const manifest = readFileSync('stackchan/manifest.json', 'utf8')
    const wasmManifest = readFileSync('stackchan/manifest_wasm.json', 'utf8')

    assert.match(source, /import \{ HorizontalExpandingKeyboard \} from 'keyboard'/)
    assert.match(source, /import \{ KeyboardField \} from 'common\/keyboard'/)
    assert.match(source, /class NetworkListScreenColumnBehavior extends Behavior/)
    assert.match(source, /const ListItemTemplate[^=]*= Port\.template/)
    assert.match(source, /drawTexture\(new WiFiStripTexture/)
    assert.match(source, /HorizontalExpandingKeyboard\(this\.data, \{/)
    assert.match(source, /target: this\.data\.FIELD/)
    assert.match(manifest, /\$\(MODDABLE\)\/modules\/input\/expanding-keyboard\/horizontal\/manifest\.json/)
    assert.match(wasmManifest, /\$\(MODDABLE\)\/modules\/input\/expanding-keyboard\/horizontal\/manifest\.json/)
  })

  test('password keyboard layout fits within the 320x240 Stack-chan screen', () => {
    const source = readFileSync('stackchan/setup-ui.ts', 'utf8')

    assert.match(source, /const SCREEN_HEIGHT = 240/)
    assert.match(source, /const PASSWORD_HEADER_HEIGHT = 36/)
    assert.match(source, /const PASSWORD_FIELD_HEIGHT = 32/)
    assert.match(source, /const HORIZONTAL_KEYBOARD_HEIGHT = 164/)
    assert.match(source, /const PASSWORD_CONTENT_HEIGHT = SCREEN_HEIGHT - PASSWORD_HEADER_HEIGHT/)
    assert.match(source, /PASSWORD_FIELD_HEIGHT \+ HORIZONTAL_KEYBOARD_HEIGHT <= PASSWORD_CONTENT_HEIGHT/)
    assert.doesNotMatch(source, /Horizontal keyboard from Moddable examples/)
  })

  test('Moddable expanding keyboard supports uppercase, numbers, and symbols via toggle rows', () => {
    const moddablePath = process.env.MODDABLE ?? '/home/openclaw/.local/share/moddable'
    const commonKeyboard = readFileSync(`${moddablePath}/modules/input/expanding-keyboard/common/keyboard.js`, 'utf8')

    assert.match(commonKeyboard, /\["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM/)
    assert.match(commonKeyboard, /\["1234567890", "#\$%&\*\(\)_@", "!\?\/\\\\;:=\+-/)
    assert.match(commonKeyboard, /ToggleModes\.SHIFT/)
    assert.match(commonKeyboard, /ToggleModes\.ALT/)
  })

  test('fake WASM network list contains open and secured networks', () => {
    const networks = getWasmFakeNetworks()

    assert.ok(networks.length >= 3)
    assert.ok(networks.some((network) => network.authentication === 'open'))
    assert.ok(networks.some((network) => network.authentication !== 'open'))
    assert.deepEqual(
      networks.map((network) => network.ssid),
      ['StackChan-Open', 'StackChan-Secure', 'Workshop-WiFi'],
    )
  })

  test('RSSI maps to stable signal variants', () => {
    assert.equal(signalStrengthForRssi(-45), 3)
    assert.equal(signalStrengthForRssi(-67), 2)
    assert.equal(signalStrengthForRssi(-78), 1)
    assert.equal(signalStrengthForRssi(-90), 0)
  })

  test('selecting open network stores a draft without requiring password', () => {
    const state = selectNetwork(createSetupState(getWasmFakeNetworks()), 'StackChan-Open')

    assert.equal(state.view, 'home')
    assert.deepEqual(state.draft, { ssid: 'StackChan-Open', password: '' })
    assert.equal(state.status, 'draft-ready')
  })

  test('selecting secured network opens password state', () => {
    const state = selectNetwork(createSetupState(getWasmFakeNetworks()), 'StackChan-Secure')

    assert.equal(state.view, 'password')
    assert.equal(state.selectedNetwork?.ssid, 'StackChan-Secure')
    assert.equal(state.passwordInput, '')
    assert.deepEqual(state.draft, {})
  })

  test('password reducer handles char, backspace, submit, and masked display', () => {
    const selected = selectNetwork(createSetupState(getWasmFakeNetworks()), 'StackChan-Secure')
    const typed = reducePasswordInput(reducePasswordInput(reducePasswordInput(selected, 's'), '3'), 'c')
    const corrected = reducePasswordInput(typed, 'backspace')
    const submitted = reducePasswordInput(reducePasswordInput(corrected, 'r'), 'ok')

    assert.equal(maskPassword(typed.passwordInput), '***')
    assert.equal(corrected.passwordInput, 's3')
    assert.equal(submitted.view, 'home')
    assert.deepEqual(submitted.draft, { ssid: 'StackChan-Secure', password: 's3r' })
    assert.equal(submitted.status, 'draft-ready')
  })
})
