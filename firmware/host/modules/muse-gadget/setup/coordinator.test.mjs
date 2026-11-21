import assert from 'node:assert/strict'
import test from 'node:test'
import { CONNECT_LABEL, createSetupCoordinator, SAVE_LABEL } from './coordinator.js'
import { describeSetupPrompt } from './prompt.js'

function fixture() {
  let live = true
  const calls = []
  const owner = {
    current: (generation) => live && generation === 7,
    commitApproved: async () => {
      calls.push('save')
      return { saved: true }
    },
    connectApproved: async () => {
      calls.push('connect')
      return { connected: true }
    },
    close() {
      live = false
      calls.push('close')
    },
  }
  return {
    owner,
    calls,
    expire() {
      live = false
    },
    flow: createSetupCoordinator(),
  }
}

test('accept and prompt rendering do not save or connect; approvals are separate', async () => {
  const f = fixture()
  f.flow.acceptProvision(f.owner, 7)
  const save = describeSetupPrompt(f.flow)
  assert.equal(save.buttonLabel, SAVE_LABEL)
  assert.deepEqual(f.calls, [])
  assert.throws(() => f.flow.approveConnect(f.flow.snapshot().revision))
  await save.confirm()
  assert.deepEqual(f.calls, ['save'])
  const connect = describeSetupPrompt(f.flow)
  assert.equal(connect.buttonLabel, CONNECT_LABEL)
  assert.throws(() => save.confirm())
  await connect.confirm()
  assert.deepEqual(f.calls, ['save', 'connect'])
  assert.equal(f.flow.snapshot().phase, 'connected')
})

test('duplicate clicks share one operation; old prompt cannot approve replacement', async () => {
  const f = fixture(),
    newer = fixture()
  f.flow.acceptProvision(f.owner, 7)
  const stale = describeSetupPrompt(f.flow)
  f.flow.acceptProvision(newer.owner, 7)
  assert.throws(() => stale.confirm())
  const prompt = describeSetupPrompt(f.flow)
  const first = prompt.confirm(),
    second = prompt.confirm()
  assert.equal(first, second)
  await first
  assert.deepEqual(newer.calls, ['save'])
})

test('close before operation starts prevents the native call', async () => {
  const f = fixture()
  f.flow.acceptProvision(f.owner, 7)
  const work = describeSetupPrompt(f.flow).confirm()
  f.flow.close()
  await assert.rejects(work)
  assert.deepEqual(f.calls, ['close'])
  assert.equal(f.flow.snapshot().phase, 'closed')
})

test('close after native operation starts discards its late result', async () => {
  const f = fixture()
  let resolve
  f.owner.commitApproved = () =>
    new Promise((done) => {
      f.calls.push('save')
      resolve = done
    })
  f.flow.acceptProvision(f.owner, 7)
  const work = describeSetupPrompt(f.flow).confirm()
  await Promise.resolve()
  f.flow.close()
  resolve({ saved: true })
  await assert.rejects(work)
  assert.equal(f.flow.snapshot().phase, 'closed')
  assert.deepEqual(f.calls, ['save', 'close'])
})

test('expired native generation and undefined success payload cannot advance UI', async () => {
  const f = fixture()
  f.flow.acceptProvision(f.owner, 7)
  f.expire()
  assert.throws(() => describeSetupPrompt(f.flow).confirm())
  assert.equal(f.flow.snapshot().phase, 'expired')
  const g = fixture()
  g.owner.commitApproved = async () => undefined
  g.flow.acceptProvision(g.owner, 7)
  await assert.rejects(describeSetupPrompt(g.flow).confirm())
  assert.equal(g.flow.snapshot().phase, 'review')
})

test('errors and arbitrary result fields never enter display metadata', async () => {
  const f = fixture()
  f.owner.commitApproved = () => {
    throw new Error('secret-value')
  }
  f.flow.acceptProvision(f.owner, 7)
  await assert.rejects(describeSetupPrompt(f.flow).confirm(), (e) => e.message === 'setup_operation_failed')
  assert.ok(!JSON.stringify(describeSetupPrompt(f.flow)).includes('secret-value'))
  f.owner.commitApproved = () => ({ saved: true, password: 'secret-value' })
  await describeSetupPrompt(f.flow).confirm()
  assert.ok(!JSON.stringify(describeSetupPrompt(f.flow)).includes('secret-value'))
})

test('native validation errors are sanitized and confirmed save remains known after close', async () => {
  const f = fixture()
  f.owner.current = () => {
    throw new Error('private details')
  }
  assert.throws(
    () => f.flow.acceptProvision(f.owner, 7),
    (error) => error.message === 'provision_expired',
  )
  const g = fixture()
  g.flow.acceptProvision(g.owner, 7)
  await describeSetupPrompt(g.flow).confirm()
  g.flow.close()
  assert.equal(g.flow.snapshot().saved, true)
})

test('native restored owner enters saved phase without writes or connections', async () => {
  const f = fixture()
  const state = f.flow.acceptStored(f.owner, 7)
  assert.equal(state.phase, 'saved')
  assert.equal(state.saved, true)
  assert.deepEqual(f.calls, [])
  assert.throws(() => f.flow.approveSave(state.revision))
  await f.flow.approveConnect(state.revision)
  assert.deepEqual(f.calls, ['connect'])
})

test('coordinator close awaits asynchronous owner shutdown and sanitizes failures', async () => {
  const f = fixture()
  let reject
  f.owner.close = () =>
    new Promise((_resolve, fail) => {
      reject = fail
    })
  f.flow.acceptProvision(f.owner, 7)
  const closing = f.flow.close()
  assert.equal(f.flow.close(), closing)
  reject(new Error('secret-value'))
  await assert.rejects(closing, (error) => error.message === 'setup_close_failed')
})

test('ended conversation returns to saved without another write or automatic reconnect', async () => {
  const f = fixture()
  f.flow.acceptStored(f.owner, 7)
  await f.flow.approveConnect(f.flow.snapshot().revision)
  const previous = f.flow.snapshot().revision
  const next = f.flow.connectionEnded()
  assert.equal(next.phase, 'saved')
  assert.equal(next.saved, true)
  assert.ok(next.revision > previous)
  assert.deepEqual(f.calls, ['connect'])
  assert.equal(f.flow.connectionEnded().revision, next.revision)
})
