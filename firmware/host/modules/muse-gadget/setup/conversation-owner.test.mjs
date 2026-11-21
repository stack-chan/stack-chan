import assert from 'node:assert/strict'
import test from 'node:test'
import { createConversationAccountOwner } from './conversation-owner.js'

function fixture(onProgress, onDiagnostic) {
  const calls = [],
    options = []
  let resolveStart, rejectStart
  const native = {
    current: (g) => g === 1,
    commitApproved: () => ({ saved: true }),
    connectApproved: async () => {
      calls.push('prepare')
      return { prepared: true }
    },
    close() {
      calls.push('account.close')
    },
  }
  const pipeline = {
    start() {
      calls.push('start')
      return new Promise((resolve, reject) => {
        resolveStart = resolve
        rejectStart = reject
      })
    },
    async close() {
      calls.push('pipeline.close')
      rejectStart?.(new Error('abort'))
    },
    setMicrophoneMuted(value) {
      calls.push(['mute', value])
    },
  }
  const owner = createConversationAccountOwner(native, {
    onProgress,
    onDiagnostic,
    microphone: {},
    speaker: {},
    createConversation(account) {
      assert.equal(account, native)
      return {}
    },
    createPipeline(value) {
      options.push(value)
      return pipeline
    },
    createScope() {
      return {
        abort() {
          calls.push('abort')
        },
      }
    },
  })
  return {
    owner,
    pipeline,
    native,
    calls,
    options,
    finish() {
      resolveStart()
    },
    async reachStart() {
      for (let i = 0; i < 12; i++) await Promise.resolve()
    },
  }
}

test('HTTP preparation is not conversation readiness; initial pipeline remains muted', async () => {
  const f = fixture()
  assert.deepEqual(f.calls, [])
  const work = f.owner.connectApproved(1)
  await f.reachStart()
  assert.equal(f.options[0].microphoneMuted, true)
  assert.throws(() => f.owner.setMicrophoneMuted(false))
  let done = false
  work.then(() => (done = true))
  await Promise.resolve()
  assert.equal(done, false)
  f.finish()
  assert.deepEqual(await work, { connected: true })
  f.owner.setMicrophoneMuted(false)
  assert.ok(f.calls.some((value) => Array.isArray(value) && value[0] === 'mute' && value[1] === false))
  await f.owner.close()
  assert.ok(f.calls.indexOf('pipeline.close') < f.calls.indexOf('account.close'))
})

test('close cancels preparation before waiting for it', async () => {
  const f = fixture()
  let reject
  f.native.connectApproved = () =>
    new Promise((_resolve, fail) => {
      reject = fail
    })
  f.native.close = () => {
    f.calls.push('account.close')
    reject(new Error('cancelled'))
  }
  const work = f.owner.connectApproved(1)
  await Promise.resolve()
  const closing = f.owner.close()
  await assert.rejects(work)
  await closing
  assert.equal(f.options.length, 0)
})

test('close during admission discards late readiness and does not send audio', async () => {
  const f = fixture()
  const work = f.owner.connectApproved(1)
  await f.reachStart()
  const closing = f.owner.close()
  await assert.rejects(work)
  await closing
  assert.equal(f.owner.current(1), false)
  assert.throws(() => f.owner.setMicrophoneMuted(false))
})

test('unimplemented native preparation cannot be mistaken for a connection', async () => {
  const f = fixture()
  f.native.connectApproved = async () => ({ connected: true })
  await assert.rejects(f.owner.connectApproved(1))
  assert.equal(f.options.length, 0)
})

test('explicit end releases only conversation and permits fresh admission', async () => {
  const f = fixture()
  const first = f.owner.connectApproved(1)
  await f.reachStart()
  f.finish()
  await first
  await f.owner.endCall()
  assert.equal(f.calls.includes('account.close'), false)
  assert.equal(f.owner.current(1), true)
  assert.throws(() => f.owner.setMicrophoneMuted(false))
  const second = f.owner.connectApproved(1)
  await f.reachStart()
  f.finish()
  await second
  assert.equal(f.options.length, 2)
  await f.owner.close()
})

test('close waits for an in-flight explicit end before closing account', async () => {
  const f = fixture(),
    first = f.owner.connectApproved(1)
  await f.reachStart()
  f.finish()
  await first
  let finishClose
  f.pipeline.close = () =>
    new Promise((resolve) => {
      f.calls.push('pipeline.close')
      finishClose = resolve
    })
  const ending = f.owner.endCall(),
    closing = f.owner.close()
  await Promise.resolve()
  assert.equal(f.calls.includes('account.close'), false)
  finishClose()
  await ending
  await closing
  assert.ok(f.calls.indexOf('pipeline.close') < f.calls.indexOf('account.close'))
})

test('network and real-time gate complete before account HTTP preparation', async () => {
  const calls = []
  let ready, reject
  const network = {
    prepare() {
      calls.push('network')
      return new Promise((resolve, fail) => {
        ready = resolve
        reject = fail
      })
    },
    close() {
      calls.push('network.close')
      reject?.(new Error('closed'))
    },
  }
  const account = {
    current: () => true,
    connectApproved() {
      calls.push('http')
      return { prepared: true }
    },
    close() {
      calls.push('account.close')
    },
  }
  const owner = createConversationAccountOwner(account, {
    network,
    createScope: () => ({ abort() {} }),
    createConversation: () => ({}),
    createPipeline: () => ({
      async start() {
        calls.push('admission')
      },
      async close() {
        calls.push('pipeline.close')
      },
    }),
  })
  const work = owner.connectApproved(1)
  await Promise.resolve()
  assert.deepEqual(calls, ['network'])
  ready()
  await work
  assert.deepEqual(calls, ['network', 'http', 'admission'])
  await owner.close()
  assert.deepEqual(calls.slice(-3), ['pipeline.close', 'network.close', 'account.close'])
})

test('pairing auth_ok follows verified account preparation independently of voice admission', async () => {
  const progress = []
  const f = fixture((value) => progress.push(value))
  const work = f.owner.connectApproved(1)
  await f.reachStart()
  assert.deepEqual(progress, ['auth_ok'])
  f.finish()
  await work
  assert.deepEqual(progress, ['auth_ok'])
  await f.owner.close()
})

test('diagnostics describe connection stages but never error content', async () => {
  const markers = []
  const f = fixture(undefined, (value) => markers.push(value))
  const work = f.owner.connectApproved(1)
  await f.reachStart()
  f.finish()
  await work
  assert.deepEqual(markers, [
    'network_start',
    'network_ready',
    'account_start',
    'account_prepared',
    'pipeline_create',
    'pipeline_start',
    'connected',
  ])
  await f.owner.close()
  for (const message of ['account refresh rejected', 'SSID=private token=secret', 'account HTTP certificate\nsecret']) {
    const values = [],
      g = fixture(undefined, (value) => values.push(value))
    g.native.connectApproved = () => {
      throw new Error(message)
    }
    await assert.rejects(g.owner.connectApproved(1), /conversation_connection_failed/)
    assert.deepEqual(values.slice(-2), [
      'failed_account',
      message === 'account refresh rejected' ? 'account_refresh_rejected' : 'account_unknown',
    ])
    assert.equal(
      values.some((value) => value.includes('secret') || value.includes('private')),
      false,
    )
  }
})

test('network and pipeline failures remain distinguishable without revealing payloads', async () => {
  const values = []
  const owner = createConversationAccountOwner(
    { current: () => true, close() {} },
    {
      network: {
        prepare() {
          throw new Error('private SSID')
        },
        close() {},
      },
      onDiagnostic: (value) => values.push(value),
    },
  )
  await assert.rejects(owner.connectApproved(1))
  assert.deepEqual(values, ['network_start', 'failed_network'])
  const markers = [],
    f = fixture(undefined, (value) => markers.push(value))
  f.pipeline.start = async () => {
    throw new Error('private response')
  }
  await assert.rejects(f.owner.connectApproved(1))
  assert.deepEqual(markers.slice(-2), ['failed_pipeline_start', 'pipeline_error_unknown'])
  assert.equal(markers.includes('private response'), false)
})

test('diagnostic callback failure does not change admission behavior', async () => {
  const f = fixture(undefined, () => {
    throw new Error('observer')
  })
  const work = f.owner.connectApproved(1)
  await f.reachStart()
  f.finish()
  assert.deepEqual(await work, { connected: true })
  await f.owner.close()
})

test('voice admission failure cannot turn successful pairing authentication into auth_failed', async () => {
  const progress = []
  const f = fixture((value) => progress.push(value))
  f.pipeline.start = async () => {
    throw new Error('voice endpoint unavailable')
  }
  await assert.rejects(f.owner.connectApproved(1), /conversation_connection_failed/)
  assert.deepEqual(progress, ['auth_ok'])
  await f.owner.close()
})

test('failed account verification reports auth_failed without auth_ok', async () => {
  const progress = []
  const f = fixture((value) => progress.push(value))
  f.native.connectApproved = async () => {
    throw new Error('account fetch rejected')
  }
  await assert.rejects(f.owner.connectApproved(1), /conversation_connection_failed/)
  assert.deepEqual(progress, ['auth_failed'])
  await f.owner.close()
})
