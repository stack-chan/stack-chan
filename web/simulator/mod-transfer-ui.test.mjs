import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8')
const simulatorSource = readFileSync(new URL('./simulator.mjs', import.meta.url), 'utf8')

describe('web MOD build and transfer UI shell', () => {
  it('exposes build, connection, transfer, and restart states in separate controls', () => {
    for (const id of [
      'mod-build-button',
      'mod-connect-web-serial-button',
      'mod-connect-ble-serial-button',
      'mod-transfer-button',
      'mod-transfer-status',
    ]) {
      assert.match(html, new RegExp(`id="${id}"`))
    }
  })

  it('keeps hardware transfer controls disabled until real transport wiring is added', () => {
    assert.match(html, /id="mod-transfer-button"[^>]*disabled/)
    assert.match(simulatorSource, /initializeModTransferShell/)
    assert.match(simulatorSource, /Build service: not connected yet/)
    assert.match(simulatorSource, /Web Serial: design stub/)
    assert.match(simulatorSource, /BLE Serial: design stub/)
  })
})
