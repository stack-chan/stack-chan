import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

for (const name of ['manifest.json', 'voice-native-manifest.json']) {
  test(`${name} bounds the WebSocket HTTP upgrade independently of frame size`, () => {
    const manifest = JSON.parse(readFileSync(new URL('../' + name, import.meta.url), 'utf8'))
    const capacity = manifest.platforms.esp32.esp32Config.CONFIG_WS_BUFFER_SIZE
    const maximumRequest = 2048 + 253 + 128 + 64 + 512
    assert.ok(capacity > maximumRequest)
    assert.equal(capacity, 4096)
  })
}
