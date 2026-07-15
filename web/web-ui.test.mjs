import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const pages = [
  'index.html',
  'flash/index.html',
  'preference/index.html',
  'editor/index.html',
  'editor/tutorial.html',
  'face-editor/index.html',
  'simulator/index.html',
]

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
  assert.match(preference, /currentValues\.get\(prop\) !== value/)
  assert.doesNotMatch(preference, /pendingPreferences|setTimeout/)
  assert.match(preference, /設定を送信しました/)
  assert.match(preference, /変更する項目がありません/)

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
  const editorScript = readFileSync('editor/editor.mjs', 'utf8')
  assert.match(editorScript, /\.output-tabs \[role="tab"\]/)
  assert.match(editorScript, /ArrowRight/)
  assert.match(editorScript, /candidate\.tabIndex = selected \? 0 : -1/)

  const editorStyles = readFileSync('editor/editor.css', 'utf8')
  assert.match(editorStyles, /\.blocklyTreeLabel\s*{[^}]*color:\s*#202428/s)
})

test('shared controls preserve the native hidden state', () => {
  const css = readFileSync('global.css', 'utf8')
  assert.match(css, /\[hidden\]\s*{[^}]*display:\s*none\s*!important/s)
})

test('flash tool exposes the M5StackChan CoreS3 firmware target', () => {
  const html = readFileSync('flash/index.html', 'utf8')
  assert.match(html, /<option value="esp32_m5stackchan_cores3">M5StackChan CoreS3<\/option>/)
  assert.doesNotMatch(html, /<option value="esp32_m5stack_fire">/)
  assert.match(html, /`manifest_\$\{event\.target\.value\}\.json`/)

  const manifest = JSON.parse(readFileSync('flash/manifest_esp32_m5stackchan_cores3.json', 'utf8'))
  assert.equal(manifest.builds.length, 1)
  assert.equal(manifest.builds[0].chipFamily, 'ESP32-S3')
  assert.deepEqual(manifest.builds[0].parts, [
    {
      path: 'tech.moddable.stackchan/m5stackchan_cores3/bootloader.bin',
      offset: 0,
    },
    {
      path: 'tech.moddable.stackchan/m5stackchan_cores3/partition-table.bin',
      offset: 32768,
    },
    {
      path: 'tech.moddable.stackchan/m5stackchan_cores3/xs_esp32.bin',
      offset: 65536,
    },
  ])
})

test('third-party scripts that handle editable data use subresource integrity', () => {
  for (const page of ['preference/index.html', 'editor/index.html', 'face-editor/index.html']) {
    const html = readFileSync(page, 'utf8')
    const externalScripts = [...html.matchAll(/<script[^>]+src="https:\/\/unpkg\.com\/[^>]+>/g)]
    assert.notEqual(externalScripts.length, 0)
    for (const [script] of externalScripts) {
      assert.match(script, /integrity="sha384-/, `${page} external script should have SRI`)
      assert.match(script, /crossorigin="anonymous"/, `${page} external script should use anonymous CORS`)
    }
  }
})
