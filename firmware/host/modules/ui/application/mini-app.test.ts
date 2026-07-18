import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MiniAppRegistry } from './mini-app.ts'

const content = {} as never

test('MiniAppRegistry validates, sorts, and unregisters definitions', () => {
  const registry = new MiniAppRegistry()
  let notifications = 0
  registry.subscribe(() => {
    notifications += 1
  })

  const unregisterZulu = registry.register({ id: 'sample.zulu', title: 'Zulu', create: () => content })
  registry.register({ id: 'sample.alpha', title: ' Alpha ', create: () => content })

  assert.deepEqual(
    registry.list().map(({ id, title }) => ({ id, title })),
    [
      { id: 'sample.alpha', title: 'Alpha' },
      { id: 'sample.zulu', title: 'Zulu' },
    ],
  )
  assert.equal(notifications, 2)

  unregisterZulu()
  unregisterZulu()
  assert.deepEqual(
    registry.list().map(({ id }) => id),
    ['sample.alpha'],
  )
  assert.equal(notifications, 3)
})

test('MiniAppRegistry rejects invalid and duplicate definitions', () => {
  const registry = new MiniAppRegistry()
  registry.register({ id: 'valid-app', title: 'Valid', create: () => content })

  assert.throws(() => registry.register({ id: 'Not Valid', title: 'Invalid', create: () => content }), /mini app id/)
  assert.throws(() => registry.register({ id: 'empty-title', title: '   ', create: () => content }), /mini app title/)
  assert.throws(
    () => registry.register({ id: 'valid-app', title: 'Duplicate', create: () => content }),
    /already registered/,
  )
})

test('registry snapshots metadata without exposing the create callback', () => {
  const registry = new MiniAppRegistry()
  registry.register({ id: 'sample', title: 'Sample', create: () => content })
  const listed = registry.list()[0] as Record<string, unknown>

  assert.equal(Object.isFrozen(listed), true)
  assert.equal('create' in listed, false)
})
