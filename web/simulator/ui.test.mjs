import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { profileFor } from '../editor/capabilities.mjs'
import { xsArchiveVersion } from '../editor/mod-builder.mjs'

describe('simulator MOD sample', () => {
  it('matches the XS version supported by the simulator profile', () => {
    const archive = readFileSync(new URL('./samples/stackchan-sample-mod.xsa', import.meta.url))
    assert.deepEqual(xsArchiveVersion(archive), profileFor('simulator').xsArchiveVersion)
  })

  it('does not expose host-specific build paths', () => {
    const archive = readFileSync(new URL('./samples/stackchan-sample-mod.xsa', import.meta.url))
    const text = archive.toString('latin1')
    assert.doesNotMatch(text, /\/(?:home|Users|tmp)\//)
    assert.doesNotMatch(text, /[A-Za-z]:\\/)
  })

  it('applies the starter colors and balloon through the public SDK', async () => {
    const source = readFileSync(new URL('./samples/sample-mod/mod.js', import.meta.url), 'utf8')
    const defineApp = (value) => ({ apiVersion: 2, ...value })
    const app = new Function(
      'defineApp',
      'trace',
      source.replace(/^import .*\n/, '').replace('export default', 'return')
    )(defineApp, () => {})
    const calls = []
    app.setup({
      face: { setColor: (...args) => calls.push(['color', ...args]) },
      ui: { showBalloon: (text) => calls.push(['balloon', text]) },
    })
    assert.deepEqual(calls, [
      ['color', 'primary', { r: 48, g: 224, b: 255 }],
      ['color', 'secondary', { r: 255, g: 112, b: 216 }],
      ['balloon', 'sample .xsa OK'],
    ])
  })
})
