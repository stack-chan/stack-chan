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


test('does not render obsolete A-D demo buttons', () => {
  const html = readFileSync('simulator/index.html', 'utf8')
  const script = readFileSync('simulator/simulator.mjs', 'utf8')
  const bridge = readFileSync('simulator/bridge.mjs', 'utf8')

  for (const obsoleteText of ['A:', 'B:', 'C:', '喋る', 'A/B/C', 'キョロキョロ', 'サーボ動作', '色変更']) {
    assert.equal(html.includes(obsoleteText), false, `${obsoleteText} should not appear in simulator UI`)
  }

  for (const obsoleteId of ['button-a', 'button-b', 'button-c', 'speech-toggle']) {
    assert.equal(html.includes(obsoleteId), false, `${obsoleteId} should not be rendered`)
    assert.equal(script.includes(obsoleteId), false, `${obsoleteId} should not be wired`)
  }

  assert.equal(script.includes('setHtmlAction'), false)
  assert.match(script, /Button: buttonBridge\.Button/)
  assert.match(bridge, /createHostButtonBridge/)
})
