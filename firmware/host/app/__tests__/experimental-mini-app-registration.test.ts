import assert from 'node:assert/strict'
import { test } from 'node:test'

import { rollbackExperimentalMiniAppRegistrations } from '../experimental-mini-app-registration.js'

test('rollback continues in reverse order after an unregister callback throws', () => {
  const attempts: string[] = []
  const errors: unknown[] = []

  rollbackExperimentalMiniAppRegistrations(
    [
      () => attempts.push('first'),
      () => {
        attempts.push('second')
        throw new Error('rollback failed')
      },
    ],
    (error) => errors.push(error),
  )

  assert.deepEqual(attempts, ['second', 'first'])
  assert.equal(errors.length, 1)
  assert.match(String(errors[0]), /rollback failed/)
})
