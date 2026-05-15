import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8')

describe('simulator MOD sample download', () => {
  it('offers a downloadable sample .xsa next to the installer', () => {
    assert.match(html, /href="\.\/samples\/stackchan-sample-mod\.xsa"/)
    assert.match(html, /download="stackchan-sample-mod\.xsa"/)
    assert.match(html, />Download sample \.xsa</)
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

  it('offers an explicit restart control for launching a saved MOD archive', () => {
    assert.match(html, /id="simulator-restart-button"/)
    assert.match(html, />Restart simulator</)
    assert.match(simulatorSource, /async restart\(\)/)
    assert.match(simulatorSource, /modRestartButton\.addEventListener\('click', async \(\) => \{/)
    assert.match(simulatorSource, /await wasmView\.restart\(\)/)
    assert.match(simulatorSource, /click Restart simulator to launch it/)
  })

  it('tells users memory-backed MOD saves are session-only but restartable', () => {
    assert.match(simulatorSource, /installedMod\.storage === 'memory'/)
    assert.match(simulatorSource, /stored in memory \(session-only\)/)
    assert.match(simulatorSource, /session-only/)
    assert.match(simulatorSource, /click Restart simulator to launch it during this browser session/)
    assert.doesNotMatch(simulatorSource, /before reloading this page/)
  })
})
