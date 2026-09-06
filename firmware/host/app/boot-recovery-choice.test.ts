import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { writeAliasPackageSubpath } from '../modules/testing/node-alias-package.js'
import { type RecoveryButton, requestBootRecoveryChoice } from './boot-recovery-choice.js'

async function source() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  writeAliasPackageSubpath(root, 'stackchan', 'errors', resolve(root, '../sdk/errors.js'))
  const { CancellationSource } = await import('./cancellation.js')
  return new CancellationSource()
}
test('recovery cancellation restores its buttons, disposes the view, and unregisters its listener', async () => {
  const cancellation = await source()
  const old = () => {}
  const a: RecoveryButton = { onChanged: old }
  const c: RecoveryButton = { onChanged: old }
  let releases = 0
  let retry: () => void
  const result = requestBootRecoveryChoice(
    'unreachable',
    cancellation.signal,
    (options) => {
      retry = options.onRetry
      return () => {
        releases++
      }
    },
    { a, c },
  )
  cancellation.cancel()
  await assert.rejects(result, { code: 'CANCELLED' })
  assert.equal(a.onChanged, old)
  assert.equal(c.onChanged, old)
  assert.equal(cancellation.size, 0)
  retry()
  assert.equal(releases, 1)
})
test('recovery cleanup preserves a newer owner of a physical button', async () => {
  const cancellation = await source()
  const a = { onChanged() {} }
  const replacement = () => {}
  let offline: () => void
  const result = requestBootRecoveryChoice(
    'unreachable',
    cancellation.signal,
    (options) => {
      offline = options.onOffline
      return () => {}
    },
    { a },
  )
  a.onChanged = replacement
  offline()
  assert.equal(await result, 'offline')
  assert.equal(a.onChanged, replacement)
  assert.equal(cancellation.size, 0)
})
test('button and synchronous presenter choices settle once and release the acquired view', async () => {
  for (const mode of ['button', 'synchronous'] as const) {
    const cancellation = await source()
    const previous = () => {}
    const a = { onChanged: previous }
    let releases = 0
    const result = requestBootRecoveryChoice(
      'retry',
      cancellation.signal,
      (options) => {
        if (mode === 'synchronous') options.onRetry()
        return () => {
          releases++
        }
      },
      { a },
    )
    if (mode === 'button') a.onChanged()
    assert.equal(await result, 'retry')
    assert.equal(releases, 1)
    assert.equal(a.onChanged, previous)
    assert.equal(cancellation.size, 0)
  }
})
test('a pre-cancelled request never installs a view or button handlers', async () => {
  const cancellation = await source()
  cancellation.cancel()
  const previous = () => {}
  const a = { onChanged: previous }
  let presentations = 0
  await assert.rejects(
    requestBootRecoveryChoice(
      'retry',
      cancellation.signal,
      () => {
        presentations++
        return () => {}
      },
      { a },
    ),
    { code: 'CANCELLED' },
  )
  assert.equal(a.onChanged, previous)
  assert.equal(presentations, 0)
})
test('presenter or cleanup failures are observable and still restore button handlers', async () => {
  for (const stage of ['present', 'release'] as const) {
    const cancellation = await source()
    const previous = () => {}
    const a = { onChanged: previous }
    const result = requestBootRecoveryChoice(
      'retry',
      cancellation.signal,
      () => {
        if (stage === 'present') throw new Error('view failed')
        return () => {
          throw new Error('view failed')
        }
      },
      { a },
    )
    if (stage === 'release') a.onChanged()
    await assert.rejects(result, /view failed/)
    assert.equal(a.onChanged, previous)
    assert.equal(cancellation.size, 0)
  }
})
