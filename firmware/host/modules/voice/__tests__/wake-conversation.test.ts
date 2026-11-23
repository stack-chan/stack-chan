import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createWakeConversation, type WakeConversationLease, type WakeConversationScope } from '../wake-conversation.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok
    reject = fail
  })
  return { promise, resolve, reject }
}

function fixture() {
  const events: string[] = []
  const wakes: Array<() => void> = []
  const faults: Array<() => void> = []
  const ends: Array<(outcome: 'completed' | 'error') => void> = []
  const detectorScopes: WakeConversationScope[] = []
  const conversationScopes: WakeConversationScope[] = []
  let owner: 'detector' | 'conversation' | undefined
  let detectorOpen: Promise<unknown> | undefined
  let unownedOpen = false
  let conversationOpen: Promise<unknown> | undefined
  let detectorClose: Promise<unknown> | undefined
  let conversationClose: Promise<unknown> | undefined

  function open(who: 'detector' | 'conversation', wait?: Promise<unknown>) {
    assert.equal(owner, undefined, 'exclusive owners never overlap')
    owner = who
    events.push(`open:${who}`)
    const lease: WakeConversationLease = {
      async close() {
        assert.equal(owner, who, 'only current owner can close')
        events.push(`close:${who}`)
        await (who === 'detector' ? detectorClose : conversationClose)
        owner = undefined
        events.push(`released:${who}`)
      },
    }
    return wait ? wait.then(() => lease) : lease
  }

  const coordinator = createWakeConversation({
    openDetector(onWake, scope, onFault) {
      faults.push(onFault)
      wakes.push(onWake)
      detectorScopes.push(scope)
      if (unownedOpen) {
        events.push('unavailable:detector')
        return { status: 'unavailable', ownership: 'not-acquired' } as const
      }
      return open('detector', detectorOpen)
    },
    startConversation(onEnded, scope) {
      ends.push(onEnded)
      conversationScopes.push(scope)
      return open('conversation', conversationOpen)
    },
  })
  return {
    coordinator,
    events,
    wakes,
    faults,
    ends,
    detectorScopes,
    conversationScopes,
    detectorUnavailable() {
      unownedOpen = true
    },
    detectorWillOpen(wait: Promise<unknown>) {
      detectorOpen = wait
    },
    conversationWillOpen(wait: Promise<unknown>) {
      conversationOpen = wait
    },
    detectorWillClose(wait: Promise<unknown>) {
      detectorClose = wait
    },
    conversationWillClose(wait: Promise<unknown>) {
      conversationClose = wait
    },
  }
}

test('wake and manual coalesce; conversation waits for positive detector close', async () => {
  const f = fixture()
  const c = f.coordinator
  assert.equal(c.status, 'disabled')
  assert.deepEqual(f.events, [])
  await c.enable()
  const release = deferred<void>()
  f.detectorWillClose(release.promise)
  f.wakes[0]()
  const manual = c.startManually()
  await Promise.resolve()
  assert.equal(f.detectorScopes[0].isCurrent(), false)
  assert.deepEqual(f.events, ['open:detector', 'close:detector'])
  f.wakes[0]()
  release.resolve()
  await manual
  assert.equal(c.status, 'conversing')
  assert.deepEqual(f.events, ['open:detector', 'close:detector', 'released:detector', 'open:conversation'])
})

test('disable cancels queued wake handoff but not an opened conversation', async () => {
  const f = fixture()
  const c = f.coordinator
  await c.enable()
  const release = deferred<void>()
  f.detectorWillClose(release.promise)
  f.wakes[0]()
  await Promise.resolve()
  const disable = c.disable()
  release.resolve()
  await disable
  assert.equal(c.status, 'disabled')
  assert.deepEqual(f.events, ['open:detector', 'close:detector', 'released:detector'])
  await c.enable()
  f.wakes[1]()
  await c.whenIdle()
  await c.disable()
  assert.equal(c.status, 'conversing')
  await c.stop()
  assert.equal(c.status, 'disabled')
  assert.equal(f.wakes.length, 2)
})

test('manual supersedes pending detector open; stale callbacks cannot start or reopen', async () => {
  const f = fixture()
  const c = f.coordinator
  const pending = deferred<void>()
  f.detectorWillOpen(pending.promise)
  const enabling = c.enable()
  await Promise.resolve()
  const manual = c.startManually()
  f.wakes[0]()
  assert.equal(f.detectorScopes[0].isCurrent(), false)
  pending.resolve()
  await Promise.all([enabling, manual])
  assert.equal(c.status, 'conversing')
  assert.deepEqual(f.events, ['open:detector', 'close:detector', 'released:detector', 'open:conversation'])
  await c.disable()
  await c.stop()
  f.wakes[0]()
  f.ends[0]('completed')
  await c.whenIdle()
  assert.equal(c.status, 'disabled')
  assert.equal(f.ends.length, 1)
  assert.equal(f.wakes.length, 1)
})

test('provider end waits for session close and rejects late callbacks from previous session', async () => {
  const f = fixture()
  const c = f.coordinator
  await c.enable()
  f.wakes[0]()
  await c.whenIdle()
  const release = deferred<void>()
  f.conversationWillClose(release.promise)
  f.ends[0]('completed')
  await Promise.resolve()
  assert.equal(c.status, 'closing-conversation')
  assert.equal(f.conversationScopes[0].isCurrent(), false)
  assert.equal(f.wakes.length, 1)
  release.resolve()
  await c.whenIdle()
  assert.equal(c.status, 'listening')
  f.wakes[1]()
  await c.whenIdle()
  f.ends[0]('completed')
  await c.whenIdle()
  assert.equal(c.status, 'conversing')
  assert.equal(f.ends.length, 2)
})

test('stop supersedes pending session, closes late success, and shutdown is irreversible', async () => {
  const f = fixture()
  const c = f.coordinator
  const dispatch = deferred<void>()
  f.conversationWillOpen(dispatch.promise)
  const start = c.startManually()
  await Promise.resolve()
  const stop = c.stop()
  assert.equal(f.conversationScopes[0].isCurrent(), false)
  dispatch.resolve()
  await Promise.all([start, stop])
  assert.deepEqual(f.events, ['open:conversation', 'close:conversation', 'released:conversation'])
  assert.equal(c.status, 'disabled')
  await Promise.all([c.stop(), c.shutdown(), c.shutdown()])
  await Promise.all([c.enable(), c.startManually()])
  assert.equal(c.status, 'shutdown')
  assert.equal(f.events.length, 3)
})

test('unsupported/busy open or failed detector/conversation release fails closed and never retries', async () => {
  for (const phase of ['open-detector', 'close-detector', 'open-conversation', 'close-conversation']) {
    const f = fixture()
    const c = f.coordinator
    const failure = new Error(phase)
    const pending = deferred<void>()
    if (phase === 'open-detector') f.detectorWillOpen(pending.promise)
    if (phase === 'close-detector') f.detectorWillClose(pending.promise)
    if (phase === 'open-conversation') f.conversationWillOpen(pending.promise)
    if (phase === 'close-conversation') f.conversationWillClose(pending.promise)
    let command: Promise<void>
    switch (phase) {
      case 'open-detector':
        command = c.enable()
        break
      case 'close-detector':
        await c.enable()
        command = c.startManually()
        break
      case 'open-conversation':
        command = c.startManually()
        break
      default:
        await c.startManually()
        command = c.stop()
        break
    }
    await Promise.resolve()
    pending.reject(failure)
    await command
    assert.equal(c.status, 'fault')
    assert.equal(c.failure, failure)
    const before = [...f.events]
    await c.enable()
    await c.startManually()
    await c.stop()
    await c.shutdown()
    assert.equal(c.status, 'fault')
    assert.deepEqual(f.events, before)
  }
})

test('explicit stop or provider error disarms; only a fresh enable opens a detector', async () => {
  for (const terminal of ['stop', 'error']) {
    const f = fixture()
    const c = f.coordinator
    await c.enable()
    f.wakes[0]()
    await c.whenIdle()
    if (terminal === 'stop') await c.stop()
    else {
      f.ends[0]('error')
      await c.whenIdle()
    }
    assert.equal(c.status, 'disabled')
    assert.equal(f.wakes.length, 1)
    await c.enable()
    assert.equal(c.status, 'listening')
    assert.equal(f.wakes.length, 2)
  }
})

test('dispatch returns close control without awaiting provider startup', async () => {
  const networkReady = deferred<void>()
  let enteredNetwork = false
  let closed = false
  const c = createWakeConversation({
    openDetector() {
      throw Error('not listening')
    },
    startConversation(_onEnded, scope) {
      void networkReady.promise.then(() => {
        enteredNetwork = scope.isCurrent()
      })
      return {
        close() {
          closed = true
        },
      }
    },
  })
  await c.startManually()
  await c.stop()
  assert.equal(closed, true)
  networkReady.resolve()
  await Promise.resolve()
  assert.equal(enteredNetwork, false)
})

test('attested unavailable takes no ownership, disarms, and leaves explicit manual start available', async () => {
  const f = fixture()
  f.detectorUnavailable()
  const c = f.coordinator
  await c.enable()
  assert.equal(c.status, 'disabled')
  f.wakes[0]()
  f.faults[0]()
  await c.whenIdle()
  assert.deepEqual(f.events, ['unavailable:detector'])
  await c.startManually()
  assert.equal(c.status, 'conversing')
  f.ends[0]('completed')
  await c.whenIdle()
  assert.equal(c.status, 'disabled')
  assert.deepEqual(f.events, [
    'unavailable:detector',
    'open:conversation',
    'close:conversation',
    'released:conversation',
  ])
})

test('runtime detector fault cancels a concurrent wake and waits for confirmed release', async () => {
  const f = fixture()
  const c = f.coordinator
  await c.enable()
  const release = deferred<void>()
  f.detectorWillClose(release.promise)
  f.wakes[0]()
  await Promise.resolve()
  f.faults[0]()
  assert.equal(c.status, 'closing-detector')
  assert.deepEqual(f.events, ['open:detector', 'close:detector'])
  release.resolve()
  await c.whenIdle()
  assert.equal(c.status, 'disabled')
  assert.deepEqual(f.events, ['open:detector', 'close:detector', 'released:detector'])
  await c.enable()
  f.faults[0]()
  await c.whenIdle()
  assert.equal(c.status, 'listening')
  assert.equal(f.wakes.length, 2)
})

test('ordinary detector runtime fault disarms; rejected release keeps ownership sticky', async () => {
  const f = fixture()
  const c = f.coordinator
  await c.enable()
  const release = deferred<void>()
  f.detectorWillClose(release.promise)
  f.faults[0]()
  await Promise.resolve()
  const manual = c.startManually()
  const failure = new Error('release uncertain')
  release.reject(failure)
  await manual
  assert.equal(c.status, 'fault')
  assert.equal(c.failure, failure)
  assert.deepEqual(f.events, ['open:detector', 'close:detector'])
})

test('canonical wake opt-in reflects request, unavailable result, manual path, and sticky fault', async () => {
  const f = fixture()
  const c = f.coordinator
  assert.equal(c.wakeEnabled, false)
  const enabling = c.enable()
  assert.equal(c.wakeEnabled, true)
  await enabling
  await c.startManually()
  assert.equal(c.wakeEnabled, true, 'manual audio ownership does not clear wake opt-in')
  await c.stop()
  assert.equal(c.wakeEnabled, false)

  const busy = fixture()
  const bc = busy.coordinator
  busy.detectorUnavailable()
  await bc.enable()
  assert.equal(bc.wakeEnabled, false)
  await bc.startManually()
  assert.equal(bc.status, 'conversing')
  assert.equal(bc.wakeEnabled, false, 'manual fallback never silently re-enables wake')

  const broken = fixture()
  const err = deferred<void>()
  const fc = broken.coordinator
  broken.detectorWillOpen(err.promise)
  const attempt = fc.enable()
  await Promise.resolve()
  err.reject(new Error('busy ownership not attested'))
  await attempt
  assert.equal(fc.status, 'fault')
  assert.equal(fc.wakeEnabled, false)
  await fc.enable()
  assert.equal(fc.wakeEnabled, false, 'a faulted coordinator cannot re-arm')
})
