import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const stackchanManifest = JSON.parse(readFileSync('stackchan/manifest.json', 'utf8'))

describe('Stack-chan platform manifest', () => {
  test('gives M5StackChan CoreS3 the same expandable XS creation heap as CoreS3', () => {
    const coreS3Creation = stackchanManifest.platforms['esp32/m5stack_cores3'].creation
    const m5StackChanCoreS3Creation = stackchanManifest.platforms['esp32/m5stackchan_cores3']?.creation

    assert.deepEqual(m5StackChanCoreS3Creation, coreS3Creation)
    assert.equal(m5StackChanCoreS3Creation.heap.incremental, 256)
  })
})
