import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { profileFor } from '../editor/capabilities.mjs'
import { xsArchiveVersion } from '../editor/mod-builder.mjs'

describe('simulator MOD sample', () => {
  it('documents that the sample visibly changes the face after restart', () => {
    const readme = readFileSync(new URL('./samples/README.md', import.meta.url), 'utf8')
    assert.match(readme, /setColor\?\.\('primary', 0x30, 0xe0, 0xff\)/)
    assert.match(readme, /showBalloon\?\.\('sample \.xsa OK'/)
  })

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

  it('uses the current named onContextCreated lifecycle hook', () => {
    const source = readFileSync(new URL('./samples/sample-mod/mod.js', import.meta.url), 'utf8')
    assert.match(source, /export async function onContextCreated\(robot\)/)
    assert.doesNotMatch(source, /onRobotCreated|export default/)
  })
})
