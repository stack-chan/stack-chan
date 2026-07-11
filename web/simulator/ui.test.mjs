import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8')

describe('simulator MOD sample download', () => {
  it('offers a downloadable sample .xsa next to the installer', () => {
    assert.match(html, /href="\.\/samples\/stackchan-sample-mod\.xsa"/)
    assert.match(html, /download="stackchan-sample-mod\.xsa"/)
    assert.match(html, /aria-label="サンプルMODをダウンロード"/)
    assert.match(html, /data-lucide="download"/)
  })

  it('documents that the sample visibly changes the face after restart', () => {
    const readme = readFileSync(new URL('./samples/README.md', import.meta.url), 'utf8')

    assert.match(readme, /setColor\?\.\('primary', 0x30, 0xe0, 0xff\)/)
    assert.match(readme, /showBalloon\?\.\('sample \.xsa OK'/)
  })
})

describe('simulator MOD archive install input', () => {
  const simulatorSource = readFileSync(new URL('./simulator.mjs', import.meta.url), 'utf8')

  it('keeps the file input reference across async archive saves before resetting it', () => {
    assert.match(simulatorSource, /const input = event\.currentTarget/)
    assert.match(simulatorSource, /const file = input\.files\?\.\[0\]/)
    assert.match(simulatorSource, /input\.value = ''/)
    assert.doesNotMatch(simulatorSource, /event\.currentTarget\.value = ''/)
  })

  it('offers an icon restart control', () => {
    assert.match(html, /id="simulator-restart-button"/)
    assert.match(html, /aria-label="シミュレーターを再起動"/)
    assert.match(html, /data-lucide="rotate-cw"/)
    assert.match(simulatorSource, /async restart\(\)/)
    assert.match(simulatorSource, /modRestartButton\.addEventListener\('click', async \(\) => \{/)
    assert.match(simulatorSource, /await wasmView\.restart\(\)/)
  })

  it('launches a saved MOD without showing interaction instructions', () => {
    assert.match(simulatorSource, /installedMod\.storage === 'memory'/)
    assert.match(simulatorSource, /セッション保存/)
    assert.doesNotMatch(simulatorSource, /click Restart simulator/)
    assert.doesNotMatch(html, /usage-list/)
  })
})

describe('simulator frontend guidance', () => {
  const css = readFileSync(new URL('./simulator.css', import.meta.url), 'utf8')
  const simulatorSource = readFileSync(new URL('./simulator.mjs', import.meta.url), 'utf8')

  it('starts with the usable simulator and avoids explanatory hero copy', () => {
    assert.doesNotMatch(html, /class="hero"/)
    assert.doesNotMatch(html, /ドラッグ:|ホイール:/)
    assert.match(html, /class="simulator-stage"/)
  })

  it('keeps the primary 3D scene unframed and avoids prohibited decoration', () => {
    assert.doesNotMatch(css, /radial-gradient|border-radius:\s*2[0-9]px|border-radius:\s*999px/)
    assert.doesNotMatch(html, /viewport-card|control-card/)
  })

  it('keeps desktop logs scrollable without resizing the scene', () => {
    assert.match(css, /\.app-shell\s*{[^}]*height:\s*100dvh;[^}]*overflow:\s*hidden;/s)
    assert.match(css, /#trace-log\s*{[^}]*min-height:\s*0;[^}]*overflow:\s*auto;/s)
    assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.app-shell\s*{[^}]*height:\s*auto;/)
  })

  it('resizes the WebGL renderer from its parent element', () => {
    assert.match(simulatorSource, /new ResizeObserver\(\(\) => this\.#resize\(\)\)/)
    assert.match(simulatorSource, /this\.resizeObserver\.observe\(this\.resizeTarget\)/)
    assert.match(simulatorSource, /this\.resizeTarget\?\.getBoundingClientRect\(\)/)
    assert.doesNotMatch(simulatorSource, /window\.addEventListener\('resize'/)
  })

  it('keeps a visible interaction cursor over the 3D view', () => {
    assert.match(css, /#stackchan-viewport\s*{[^}]*cursor:\s*default;/s)
    assert.doesNotMatch(css, /#stackchan-viewport\s*{[^}]*cursor:\s*none;/s)
  })
})
