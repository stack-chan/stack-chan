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

test('tool pages load the shared left drawer without changing integration ids', () => {
  for (const page of pages) {
    const html = readFileSync(page, 'utf8')
    assert.match(html, /tool-navigation\.mjs/, `${page} should load shared tool navigation`)
    assert.doesNotMatch(html, /class="tool-nav"/, `${page} should not duplicate the retired right navigation`)
  }
  const navigation = readFileSync('tool-navigation.mjs', 'utf8')
  for (const id of ['home', 'flash', 'preference', 'simulator', 'editor', 'face-editor', 'tutorial']) {
    assert.match(navigation, new RegExp(`id: '${id}'`), `drawer should expose ${id}`)
  }
  assert.match(navigation, /topbar\.prepend\(button\)/)
  assert.match(navigation, /dialog\.showModal\(\)/)
  assert.match(navigation, /aria-current/)

  const preference = readFileSync('preference/index.html', 'utf8')
  for (const id of ['ble-connect-button', 'ble-disconnect-button', 'form-preference', 'settings-form', 'wifi-clear-button']) {
    assert.match(preference, new RegExp(`id="${id}"`))
  }
  assert.match(preference, /role="alert"|data-state.*error|setStatus\([^)]*'error'/s)
  assert.match(preference, /currentValues\.get\(prop\) !== value/)
  assert.doesNotMatch(preference, /pendingPreferences|setTimeout/)
  assert.match(preference, /設定を送信しました/)
  assert.match(preference, /変更する項目がありません/)
  assert.match(preference, /globalThis\.confirm\('保存済みのSSIDとパスワードを消去しますか/)
  assert.match(preference, /\{ 'wifi\.ssid': '', 'wifi\.password': '' \}/)

  const editor = readFileSync('editor/index.html', 'utf8')
  for (const id of [
    'blockly-workspace',
    'build-button',
    'download-button',
    'install-simulator-button',
    'install-device-button',
    'project-name-display',
    'project-name-label',
    'project-menu-button',
    'project-menu',
    'recent-projects-button',
    'recent-projects-submenu',
    'recent-projects-list',
    'face-selection-button',
    'face-selection-label',
    'face-selection-menu',
    'face-selection-list',
  ]) {
    assert.match(editor, new RegExp(`id="${id}"`))
  }
  assert.match(editor, /role="tablist"/)
  assert.match(editor, /class="target-device-control"[^>]*>[\s\S]*?data-lucide="cpu"[\s\S]*?id="target-device"/)
  assert.match(editor, /id="recent-projects-button"[\s\S]*?最近開いたプロジェクト/)
  assert.match(editor, /id="recent-projects-submenu"[\s\S]*?role="menu"/)
  assert.doesNotMatch(editor, /<select[^>]+id="recent-projects"/)
  assert.doesNotMatch(editor, /id="mobile-recent-projects"/)
  assert.doesNotMatch(editor, /restore-device-button|restore-file-input|バックアップを復元/)
  assert.match(editor, /id="recovery-button"[^>]*hidden/)
  assert.match(
    editor,
    /class="build-section"[\s\S]*?id="build-button"[\s\S]*?class="asset-section"[\s\S]*?id="face-selection-button"[\s\S]*?id="asset-summary"[\s\S]*?id="embed-assets"[\s\S]*?class="output-section"/
  )
  assert.match(editor, /class="face-selection-heading">Face</)
  assert.match(editor, /class="face-selection-state">使用中</)
  assert.doesNotMatch(editor, /id="metrics-button"|評価ログを保存/)
  assert.doesNotMatch(editor, /mobile-project-dialog/)
  const editorScript = readFileSync('editor/editor.mjs', 'utf8')
  assert.match(editorScript, /\.output-tabs \[role="tab"\]/)
  assert.match(editorScript, /ArrowRight/)
  assert.match(editorScript, /candidate\.tabIndex = selected \? 0 : -1/)
  assert.match(editorScript, /label\.className = 'asset-chip-label'/)
  assert.match(editorScript, /setProjectMenuOpen/)
  assert.match(editorScript, /setRecentProjectsSubmenuOpen/)
  assert.match(editorScript, /renderFaceSelection/)
  assert.match(editorScript, /role', 'menuitemradio'/)
  assert.match(editorScript, /startProjectNameEdit/)
  assert.doesNotMatch(editorScript, /use\.textContent = selected \? '使用中' : '使う'/)
  assert.doesNotMatch(editorScript, /createMetricsReport|metricsButton|onBackup|restoreDeviceButton/)
  assert.match(editorScript, /互換性を確認しました/)
  const deviceWriteFlow = editorScript.slice(
    editorScript.indexOf('async function writeArchiveToDevice'),
    editorScript.indexOf("installDeviceButton.addEventListener('click'")
  )
  assert.doesNotMatch(deviceWriteFlow, /globalThis\.(?:confirm|alert)|onBackup/)

  const installerScript = readFileSync('editor/esptool-installer.mjs', 'utf8')
  assert.doesNotMatch(installerScript, /onBackup|現在のMODをバックアップ|削除前のMOD/)

  const editorStyles = readFileSync('editor/editor.css', 'utf8')
  assert.match(editorStyles, /\.blocklyTreeLabel\s*{[^}]*color:\s*#202428/s)
  assert.match(editorStyles, /\.blocklyDraggable:hover[^}]*cursor:\s*pointer\s*!important/s)
  assert.match(editorStyles, /\.asset-section,\s*\.build-section\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s)
  assert.match(editorStyles, /\.asset-section\s*{[^}]*background:\s*var\(--surface-raised/s)
  assert.match(editorStyles, /\.asset-chip-label\s*{[^}]*text-overflow:\s*ellipsis/s)
  assert.match(editorStyles, /\.face-selection-button\s*{[^}]*width:\s*100%/s)
  assert.match(editorStyles, /\.face-selection-menu\s*{[^}]*position:\s*absolute/s)
  assert.match(editorStyles, /\.project-name-display:hover svg/)
  assert.match(editorStyles, /\.project-menu\s*{[^}]*position:\s*absolute/s)
  assert.match(editorStyles, /\.project-submenu\s*{[^}]*right:\s*100%/s)
  assert.match(
    editorStyles,
    /@media \(max-width:\s*760px\)[\s\S]*?\.editor-layout\s*{[^}]*grid-template-rows:\s*minmax\(480px,\s*64vh\)\s*auto/s
  )
  assert.match(editorStyles, /@media \(max-width:\s*760px\)[\s\S]*?\.project-submenu\s*{[^}]*position:\s*static/s)
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
