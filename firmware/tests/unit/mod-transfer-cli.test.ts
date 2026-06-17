import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'

const firmwareRoot = process.cwd()

function read(path) {
  return readFileSync(resolve(firmwareRoot, path), 'utf8')
}

test('firmware exposes a console MOD receiver that writes only the xs partition', () => {
  const receiver = read('stackchan/services/mod-transfer/mod-transfer-cli.js')
  const manifest = read('stackchan/manifest.json')

  assert.match(receiver, /CLI\.install/)
  assert.match(receiver, /PARTITION_NAME = 'xs'/)
  assert.match(receiver, /new Flash\(PARTITION_NAME\)/)
  assert.match(receiver, /MODX /)
  assert.match(receiver, /case 'hello'/)
  assert.match(receiver, /case 'chunk'/)
  assert.match(receiver, /case 'commit'/)
  assert.doesNotMatch(receiver, /partitionOffset/)

  assert.match(manifest, /mod-transfer-cli/)
  assert.match(manifest, /base\/console\/console/)
  assert.match(manifest, /files\/flash\/manifest\.json/)
})
