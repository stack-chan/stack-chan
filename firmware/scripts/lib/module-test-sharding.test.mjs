import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseModuleTestShard, selectModuleTestShard } from './module-test-sharding.mjs'

test('module tests run as one shard when sharding is not configured', () => {
  const shard = parseModuleTestShard({})
  assert.deepEqual(shard, { index: 0, total: 1, configured: false })
  assert.deepEqual(selectModuleTestShard(['a', 'b', 'c'], shard), ['a', 'b', 'c'])
})

test('two module-test shards cover every manifest exactly once', () => {
  const manifests = Array.from({ length: 35 }, (_, index) => `manifest-${index}`)
  const first = selectModuleTestShard(
    manifests,
    parseModuleTestShard({
      STACKCHAN_MODULE_TEST_SHARD_INDEX: '0',
      STACKCHAN_MODULE_TEST_SHARD_TOTAL: '2',
    }),
  )
  const second = selectModuleTestShard(
    manifests,
    parseModuleTestShard({
      STACKCHAN_MODULE_TEST_SHARD_INDEX: '1',
      STACKCHAN_MODULE_TEST_SHARD_TOTAL: '2',
    }),
  )

  assert.deepEqual(new Set(first).intersection(new Set(second)), new Set())
  assert.deepEqual([...first, ...second].sort(), manifests.sort())
  assert.equal(first.length, 18)
  assert.equal(second.length, 17)
})

test('module-test shard configuration rejects partial and invalid values', () => {
  assert.throws(() => parseModuleTestShard({ STACKCHAN_MODULE_TEST_SHARD_INDEX: '0' }), /must be set together/)
  assert.throws(
    () =>
      parseModuleTestShard({
        STACKCHAN_MODULE_TEST_SHARD_INDEX: '-1',
        STACKCHAN_MODULE_TEST_SHARD_TOTAL: '2',
      }),
    /non-negative integer/,
  )
  assert.throws(
    () =>
      parseModuleTestShard({
        STACKCHAN_MODULE_TEST_SHARD_INDEX: '0',
        STACKCHAN_MODULE_TEST_SHARD_TOTAL: '0',
      }),
    /at least 1/,
  )
  assert.throws(
    () =>
      parseModuleTestShard({
        STACKCHAN_MODULE_TEST_SHARD_INDEX: '2',
        STACKCHAN_MODULE_TEST_SHARD_TOTAL: '2',
      }),
    /must be less than/,
  )
})
