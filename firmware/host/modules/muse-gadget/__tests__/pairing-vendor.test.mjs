import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('community pairing and cJSON sources match their pinned provenance', async () => {
  const root = new URL('../../../../vendor/muse-gadget-sdk/pairing/', import.meta.url)
  const manifest = JSON.parse(await readFile(new URL('VENDOR_SOURCE.json', root), 'utf8'))
  assert.equal(manifest.commit, 'f2c702b123e97f4fecdaefb29ded17bb03fab0b0')
  assert.equal(manifest.cjson.tag, 'v1.7.19')
  for (const path of Object.keys(manifest.localSha256)) assert.ok(Object.hasOwn(manifest.sha256, path), path)
  for (const [path, expected] of Object.entries({ ...manifest.sha256, ...manifest.localSha256 })) {
    const bytes = await readFile(new URL(path, root))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, path)
  }
})
