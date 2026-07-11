import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const pages = ['index.html', 'flash/index.html', 'preference/index.html', 'editor/index.html', 'simulator/index.html']

test('all web tools use the shared Japanese application shell', () => {
  for (const page of pages) {
    const html = readFileSync(page, 'utf8')
    assert.match(html, /<html lang="ja">/, `${page} should declare Japanese UI text`)
    assert.match(html, /class="topbar"/, `${page} should expose the shared top bar`)
    assert.match(html, /stackchan-symbol\.png/, `${page} should expose the Stack-chan brand`)
    assert.match(html, /apple-touch-icon/, `${page} should expose an Apple touch icon`)
    assert.match(html, /data-lucide=/, `${page} should use Lucide controls`)
  }
})

test('tool pages expose consistent navigation without changing integration ids', () => {
  for (const page of pages.slice(1)) {
    const html = readFileSync(page, 'utf8')
    assert.match(html, /class="tool-nav"/, `${page} should expose tool navigation`)
    assert.match(html, /aria-current="page"/, `${page} should identify the current tool`)
  }

  const preference = readFileSync('preference/index.html', 'utf8')
  for (const id of ['ble-connect-button', 'ble-disconnect-button', 'form-preference', 'settings-form']) {
    assert.match(preference, new RegExp(`id="${id}"`))
  }
  assert.match(preference, /role="alert"|data-state.*error|setStatus\([^)]*'error'/s)

  const editor = readFileSync('editor/index.html', 'utf8')
  for (const id of [
    'blockly-workspace',
    'build-button',
    'download-button',
    'install-simulator-button',
    'install-device-button',
  ]) {
    assert.match(editor, new RegExp(`id="${id}"`))
  }
  assert.match(editor, /role="tablist"/)
})
