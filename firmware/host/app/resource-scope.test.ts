import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ResourceScope } from './owned-resources.js'

test('scope releases in reverse acquisition order despite cleanup failures', async () => {
  const scope = new ResourceScope()
  const calls: string[] = []
  scope.defer(() => {
    calls.push('first')
  })
  scope.defer(() => {
    calls.push('second')
    throw new Error('failed cleanup')
  })
  scope.defer(async () => {
    calls.push('third')
  })
  await assert.rejects(scope.close(), /failed cleanup/)
  assert.deepEqual(calls, ['third', 'second', 'first'])
  assert.equal(scope.size, 0)
  assert.throws(() => scope.defer(() => {}), /closed/)
})

test('concurrent and recursive close observe the same completion', async () => {
  const scope = new ResourceScope()
  let nested: Promise<void> | undefined
  let calls = 0
  scope.defer(() => {
    nested = scope.close()
    calls += 1
  })
  const closing = scope.close()
  assert.equal(closing, nested)
  assert.equal(closing, scope.close())
  await closing
  assert.equal(calls, 1)
})

test('ownership may be relinquished before teardown', async () => {
  const scope = new ResourceScope()
  let calls = 0
  const relinquish = scope.defer(() => {
    calls += 1
  })
  relinquish()
  relinquish()
  await scope.close()
  assert.equal(calls, 0)
})

test('a cleanup returning the owner close promise does not wait on itself', async () => {
  const scope = new ResourceScope()
  scope.defer(() => scope.close())
  await scope.close()
  assert.equal(scope.size, 0)
})

test('100 acquisition and rollback cycles return resources to baseline', async () => {
  let live = 0
  for (let cycle = 0; cycle < 100; cycle += 1) {
    const scope = new ResourceScope()
    for (let index = 0; index < 4; index += 1) {
      live += 1
      scope.own({
        close() {
          live -= 1
        },
      })
    }
    await scope.close()
    assert.equal(live, 0)
    assert.equal(scope.size, 0)
  }
})
