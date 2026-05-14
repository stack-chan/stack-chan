import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('simulator exposes a browser camera start button for permission-gated getUserMedia', () => {
  const html = readFileSync('simulator/index.html', 'utf8')
  const script = readFileSync('simulator/simulator.mjs', 'utf8')

  assert.match(html, /id="browser-camera-button"/)
  assert.match(html, /id="browser-camera-status"/)
  assert.match(script, /getElementById\('browser-camera-button'\)/)
  assert.match(script, /cameraBridge\.start\(\{ useBrowserCamera: true \}\)/)
})
