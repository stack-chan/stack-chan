import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage } from '../../testing/node-alias-package.js'
import { decodeUTF8, encodeUTF8, fnv1a32 } from '../local-peer-codec.js'

const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
writeAliasPackage(modulesRoot, 'local-peer-codec', resolve(modulesRoot, 'connectivity/local-peer-codec.js'))

const {
  decodeLocalPeerFrame,
  fragmentLocalPeerPayload,
  LOCAL_PEER_FRAGMENT_BYTES,
  LocalPeerFrameFlag,
  LocalPeerFrameKind,
} = await import('../local-peer-frame.js')

test('local peer UTF-8 codec round-trips ASCII, Japanese, and supplementary characters', () => {
  const value = 'Stack-chan ｽﾀｯｸﾁｬﾝ 🤖'
  assert.equal(decodeUTF8(encodeUTF8(value)), value)
  assert.equal(fnv1a32(value), 0xe6f8ccbc)
})

test('local peer frames preserve metadata and split at the v1-compatible boundary', () => {
  const payload = Uint8Array.from({ length: LOCAL_PEER_FRAGMENT_BYTES * 2 + 3 }, (_, index) => index & 0xff)
  const frames = fragmentLocalPeerPayload(
    LocalPeerFrameKind.DATA,
    LocalPeerFrameFlag.RELIABLE,
    0x12345678,
    0x89abcdef,
    payload,
  )

  assert.equal(frames.length, 3)
  const decoded = frames.map((frame) => decodeLocalPeerFrame(frame))
  assert.deepEqual(
    decoded.map((frame) => [frame?.messageId, frame?.fragmentIndex, frame?.fragmentCount, frame?.serviceHash]),
    [
      [0x12345678, 0, 3, 0x89abcdef],
      [0x12345678, 1, 3, 0x89abcdef],
      [0x12345678, 2, 3, 0x89abcdef],
    ],
  )
  const restored = Uint8Array.from(decoded.flatMap((frame) => Array.from(frame?.payload ?? [])))
  assert.deepEqual(restored, payload)
})

test('local peer frame decoder rejects foreign and malformed frames', () => {
  assert.equal(decodeLocalPeerFrame(new ArrayBuffer(4)), undefined)
  const foreign = new Uint8Array(18)
  foreign.set([0x42, 0x41, 0x44, 0x21])
  assert.equal(decodeLocalPeerFrame(foreign.buffer), undefined)
})
