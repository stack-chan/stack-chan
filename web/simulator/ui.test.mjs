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
})

describe('simulator MOD archive install input', () => {
  const simulatorSource = readFileSync(new URL('./simulator.mjs', import.meta.url), 'utf8')

  it('keeps the file input reference across async archive saves before resetting it', () => {
    assert.match(simulatorSource, /const input = event\.currentTarget/)
    assert.match(simulatorSource, /const file = input\.files\?\.\[0\]/)
    assert.match(simulatorSource, /input\.value = ''/)
    assert.doesNotMatch(simulatorSource, /event\.currentTarget\.value = ''/)
  })
})
