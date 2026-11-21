import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('vendored core and license match their recorded upstream provenance', () => {
  const root = new URL('../../../../vendor/muse-gadget-sdk/', import.meta.url)
  const provenance = JSON.parse(readFileSync(new URL('VENDOR_SOURCE.json', root)))
  for (const [filename, expected] of Object.entries(provenance.files)) {
    assert.equal(
      createHash('sha256')
        .update(readFileSync(new URL(filename, root)))
        .digest('hex'),
      expected,
      filename,
    )
  }
})

test('vendored voice core matches its pinned upstream hashes', () => {
  const root = new URL('../../../../vendor/muse-gadget-sdk/voice_core/', import.meta.url)
  const provenance = JSON.parse(readFileSync(new URL('VENDOR_SOURCE.json', root)))
  assert.match(provenance.commit, /^[a-f0-9]{40}$/)
  for (const [filename, expected] of Object.entries(provenance.sha256)) {
    assert.equal(
      createHash('sha256')
        .update(readFileSync(new URL(filename, root)))
        .digest('hex'),
      expected,
      filename,
    )
  }
})
