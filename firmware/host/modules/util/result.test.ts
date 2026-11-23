import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  andThen,
  andThenAsync,
  ensure,
  err,
  fromMaybe,
  fromPromise,
  map,
  mapErr,
  match,
  ok,
  type Result,
  withResourceScope,
} from './result.js'

test('Result combinators short-circuit on the first Err and preserve typed error variants', () => {
  const step1 = ensure<string, { kind: 'missing' }>('42', () => ({ kind: 'missing' }))
  const step2 = andThen(step1, (raw) => {
    const parsed = Number.parseInt(raw, 10)
    return Number.isNaN(parsed) ? err({ kind: 'nan' as const }) : ok(parsed)
  })
  const doubled = map(step2, (value) => value * 2)

  assert.deepEqual(doubled, { ok: true, value: 84 })

  const missing = ensure<string, { kind: 'missing' }>(undefined, () => ({ kind: 'missing' }))
  let called = false
  const skipped = andThen(missing, () => {
    called = true
    return ok(1)
  })
  assert.equal(called, false)
  assert.deepEqual(skipped, { ok: false, error: { kind: 'missing' } })

  const remapped = mapErr(skipped, (e) => `err:${e.kind}`)
  const summary = match(remapped, {
    ok: (v) => `ok:${v}`,
    err: (e) => e,
  })
  assert.equal(summary, 'err:missing')
})

test('fromMaybe and fromPromise convert existing Stack-chan contracts onto the Result rail', async () => {
  assert.deepEqual(
    fromMaybe({ success: true, value: 'hi' }, () => 'failed'),
    { ok: true, value: 'hi' },
  )
  assert.deepEqual(
    fromMaybe({ success: false, reason: 'busy' }, (reason) => ({ kind: 'audio-busy', reason })),
    { ok: false, error: { kind: 'audio-busy', reason: 'busy' } },
  )

  const resolved = await fromPromise(Promise.resolve(7), () => 'unexpected')
  assert.deepEqual(resolved, { ok: true, value: 7 })

  const rejected = await fromPromise(Promise.reject(new Error('boom')), (cause) =>
    cause instanceof Error ? cause.message : String(cause),
  )
  assert.deepEqual(rejected, { ok: false, error: 'boom' })
})

test('andThenAsync chains sync and async Result steps without running downstream on failure', async () => {
  let ranSecond = false
  const failed = await andThenAsync(err<'offline'>('offline'), async () => {
    ranSecond = true
    return ok('done')
  })
  assert.equal(ranSecond, false)
  assert.deepEqual(failed, { ok: false, error: 'offline' })

  const succeeded = await andThenAsync(ok(3), async (n) => ok(n + 4))
  assert.deepEqual(succeeded, { ok: true, value: 7 })
})

test('withResourceScope releases acquired resources in reverse order on Err or explicit close', async () => {
  const closed: string[] = []

  const rolledBack = await withResourceScope<string, { kind: 'step2-failed' }>(async (scope) => {
    const first = await scope.acquire<string, never>(
      () => ok('first'),
      (name) => {
        closed.push(name)
      },
    )
    if (!first.ok) return first

    const second = await scope.acquire<string, { kind: 'step2-failed' }>(
      async () => err({ kind: 'step2-failed' as const }),
      () => {
        closed.push('second')
      },
    )
    if (!second.ok) return second
    return ok('never')
  })

  assert.deepEqual(rolledBack, { ok: false, error: { kind: 'step2-failed' } })
  assert.deepEqual(closed, ['first'])

  closed.length = 0
  const acquired = await withResourceScope<string, never>(async (scope) => {
    await scope.acquire(
      () => ok('a'),
      (v) => {
        closed.push(v)
      },
    )
    await scope.acquire(
      () => ok('b'),
      (v) => {
        closed.push(v)
      },
    )
    return ok('ready')
  })
  assert.equal(acquired.ok, true)
  if (acquired.ok) {
    assert.equal(acquired.value.value, 'ready')
    assert.deepEqual(closed, [])
    await acquired.value.close()
    await acquired.value.close()
    assert.deepEqual(closed, ['b', 'a'])
  }
})

test('withResourceScope releases late acquisitions that resolve after scope rollback', async () => {
  const closed: string[] = []
  let resolveLateOpen: ((value: Result<string, never>) => void) | undefined

  const result = await withResourceScope<string, { kind: 'early-failure' }>(async (scope) => {
    void scope.acquire<string, never>(
      () =>
        new Promise((resolve) => {
          resolveLateOpen = resolve
        }),
      (name) => {
        closed.push(name)
      },
    )
    return err({ kind: 'early-failure' as const })
  })

  assert.deepEqual(result, { ok: false, error: { kind: 'early-failure' } })
  assert.deepEqual(closed, [])

  resolveLateOpen?.(ok('late-resource'))
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(closed, ['late-resource'])
})

test('overlapping closes wait for the same pending resource cleanup', async () => {
  let finishCleanup: () => void = () => {}
  const pendingCleanup = new Promise<void>((resolve) => {
    finishCleanup = resolve
  })
  let cleanupCalls = 0
  const acquired = await withResourceScope(async (scope) => {
    await scope.acquire(
      () => ok('resource'),
      async () => {
        cleanupCalls += 1
        await pendingCleanup
      },
    )
    return ok(undefined)
  })
  assert.ok(acquired.ok)

  const firstClose = acquired.value.close()
  let secondFinished = false
  const secondClose = acquired.value.close().then(() => {
    secondFinished = true
  })
  await Promise.resolve()
  const finishedBeforeCleanup = secondFinished
  finishCleanup()
  await Promise.all([firstClose, secondClose])

  assert.equal(finishedBeforeCleanup, false)
  assert.equal(cleanupCalls, 1)
})
