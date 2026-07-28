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

test('concurrent close callers await the same failure', async () => {
  let rejectClose: ((error: Error) => void) | undefined
  const closeStarted = new Promise<void>((_, reject) => {
    rejectClose = reject
  })
  const error = new Error('asynchronous close failed')
  const resources = new OwnedResources([() => closeStarted])

  const first = resources.close()
  const second = resources.close()
  rejectClose?.(error)

  await assert.rejects(first, error)
  await assert.rejects(second, error)
  assert.equal(resources.close(), first)
})
