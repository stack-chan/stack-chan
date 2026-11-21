import assert from 'node:assert/strict'
import test from 'node:test'
import { openLocalWake } from './wake-audio.js'

function fixture(opts = {}) {
  const events = []
  let current = true,
    feeding,
    erroring,
    reader,
    scopeAbrt = false
  const decoded = []
  const runtime = {
    async acquire(mic, spk, needs, scope) {
      assert.equal(mic.runtime, spk.runtime)
      assert.deepEqual(needs.input, [format])
      assert.equal(needs.preRollMs, 0)
      assert.deepEqual(needs.output, [format])
      assert.equal(needs.duplex, 'half')
      assert.ok(scope.budget.maxBufferedBytes >= 2048)
      events.push('lease')
      if (opts.lateLease) await opts.lateLease
      if (opts.acquireError) throw opts.acquireError
      return {
        input: { format },
        async close() {
          events.push('close lease')
          if (opts.closeError) throw opts.closeError
        },
      }
    },
  }
  const format = { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 }
  const args = {
    microphone: { runtime },
    speaker: { runtime },
    createScope() {
      return {
        signal: {},
        abort() {
          scopeAbrt = true
          events.push('abort')
        },
      }
    },
    createDetector() {
      events.push('detector')
      return {
        start() {
          events.push('detector start')
          if (opts.failStart) throw new Error('detector unavailable')
        },
        detect(bytes) {
          decoded.push([...bytes])
          return bytes[0] === 2
        },
        close() {
          events.push('detector close')
        },
      }
    },
    readSource(_input, consume, onError) {
      feeding = consume
      erroring = onError
      reader = {
        close() {
          events.push('detach')
        },
      }
      return reader
    },
    onWake() {
      events.push('wake')
    },
    onEnd() {
      events.push('end')
    },
  }
  return {
    args,
    events,
    decoded,
    feed: (bytes) => feeding(bytes),
    fail: () => erroring(),
    isAborted: () => scopeAbrt,
    scope: { isCurrent: () => current },
    supersede: () => {
      current = false
    },
  }
}

test('only local narrow PCM view is processed, one match disables feed, and release closes every owner', async () => {
  const f = fixture()
  const owner = await openLocalWake(f.args, f.scope)
  f.feed(new Uint8Array([66, 77, 1, 0, 22, 88]).subarray(2, 4))
  f.feed(new Uint8Array([2, 0]))
  f.feed(new Uint8Array([2, 0]))
  assert.deepEqual(f.decoded, [
    [1, 0],
    [2, 0],
  ])
  const closure = owner.close()
  assert.equal(owner.close(), closure)
  await closure
  assert.equal(f.isAborted(), true)
  assert.deepEqual(f.events, [
    'lease',
    'detector',
    'detector start',
    'wake',
    'detach',
    'abort',
    'detector close',
    'close lease',
  ])
})

test('late lease after cancellation never starts local inference and is releasable', async () => {
  let complete
  const f = fixture({
    lateLease: new Promise((resolve) => {
      complete = resolve
    }),
  })
  const acquiring = openLocalWake(f.args, f.scope)
  f.supersede()
  complete()
  const owner = await acquiring
  await owner.close()
  assert.deepEqual(f.events, ['lease', 'abort', 'close lease'])
})

test('a recoverable detector startup failure disables wake only after positive release', async () => {
  const f = fixture({ failStart: true })
  const owner = await openLocalWake(f.args, f.scope)
  await owner.close()
  assert.deepEqual(f.events, ['lease', 'detector', 'detector start', 'abort', 'detector close', 'close lease', 'end'])
})

test('an unconfirmed local close rejects and never reports fallback as safe', async () => {
  const f = fixture({ failStart: true, closeError: Error('unsafe') })
  await assert.rejects(openLocalWake(f.args, f.scope), /release unconfirmed/)
  assert.ok(!f.events.includes('end'))
  assert.ok(f.events.includes('detector close'))
})

test('rejects an odd PCM fragment without forwarding it or permitting another detection', async () => {
  const f = fixture()
  const owner = await openLocalWake(f.args, f.scope)
  f.feed(new Uint8Array([2]))
  f.feed(new Uint8Array([2, 0]))
  await owner.close()
  assert.deepEqual(f.decoded, [])
  assert.equal(f.events.filter((event) => event === 'end').length, 1)
  assert.ok(!f.events.includes('wake'))
})

test('only a known pre-acquire busy rejection certifies no claim', async () => {
  const f = fixture({ acquireError: Object.assign(new Error('locked by existing owner'), { code: 'device_busy' }) })
  assert.deepEqual(await openLocalWake(f.args, f.scope), { status: 'unavailable', ownership: 'not-acquired' })
  assert.deepEqual(f.events, ['lease', 'abort'])
  const u = fixture({ acquireError: new Error('close failure while opening device') })
  await assert.rejects(openLocalWake(u.args, u.scope), /close failure/)
})
