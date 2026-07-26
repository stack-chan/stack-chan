import assert from 'node:assert/strict'
import test from 'node:test'
import { OwnedResources } from './owned-resources.js'

test('owned resources close once in registration order', async () => {
  const calls: string[] = []
  const resources = new OwnedResources([
    () => {
      calls.push('dock')
    },
    async () => {
      await Promise.resolve()
      calls.push('async-resource')
    },
  ])

  await resources.close()
  await resources.close()

  assert.deepEqual(calls, ['dock', 'async-resource'])
})

test('owned resources continue closing after an error and reject with the first error', async () => {
  const calls: string[] = []
  const firstError = new Error('dock close failed')
  const resources = new OwnedResources([
    () => {
      calls.push('dock')
      throw firstError
    },
    () => {
      calls.push('audio')
      throw new Error('audio close failed')
    },
    () => {
      calls.push('lighting')
    },
  ])

  await assert.rejects(resources.close(), firstError)
  assert.deepEqual(calls, ['dock', 'audio', 'lighting'])
})
