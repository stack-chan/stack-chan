import assert from 'node:assert/strict'
import test from 'node:test'
import { createTransport } from '../transport-core.js'

function fixture() {
  const timers = [],
    scheduled = [],
    events = []
  const Timer = {
    repeat(callback, interval) {
      const timer = { callback, interval }
      timers.push(timer)
      return timer
    },
    schedule(timer, interval, repeat) {
      assert.ok(timer)
      scheduled.push({ timer, interval, repeat })
    },
    clear(timer) {
      timer.cleared = true
    },
  }
  const calls = []
  const Transport = createTransport({
    Timer,
    ArrayBuffer: { fromString: (text) => new TextEncoder().encode(text).buffer },
    Base: class {},
    native: (name) => () => {
      calls.push(name)
      if (name === 'xs_live_transport_read') return events.shift()
      if (name === 'xs_live_transport_stats') return { samples: 10 }
    },
  })
  return { Transport, timers, scheduled, events, calls }
}

test('successful native polls reschedule the same timer from completion', async () => {
  const f = fixture()
  const seen = []
  new f.Transport((event) => seen.push(event))
  f.events.push({ type: 'message', data: 'hello' })
  const timer = f.timers[0]
  timer.callback(timer)
  assert.deepEqual(seen, [{ type: 'message', data: 'hello' }])
  assert.deepEqual(f.scheduled, [{ timer, interval: timer.interval, repeat: timer.interval }])
})
test('CoreS3 offers initiate DTLS without changing other SDP attributes', async () => {
  const f = fixture()
  const seen = []
  new f.Transport((event) => seen.push(event))
  const sdp =
    'v=0\r\na=setup:actpass\r\na=mid:0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=setup:actpass\r\n'
  f.events.push({ type: 'offer', sdp })
  f.timers[0].callback(f.timers[0])
  assert.equal(seen[0].sdp, sdp.replaceAll('a=setup:actpass', 'a=setup:active'))
})
test('native release resolves close and does not reschedule a cleared timer', async () => {
  const f = fixture()
  const transport = new f.Transport(() => {})
  const closed = transport.close()
  f.events.push({ type: 'released' })
  f.timers[0].callback(f.timers[0])
  await closed
  assert.ok(f.timers[0].cleared)
  assert.equal(f.scheduled.length, 0)
  assert.deepEqual(transport.stats, { samples: 10 })
  assert.equal(f.calls.filter((name) => name === 'xs_live_transport_release').length, 1)
})
test('an explicit protocol close stops audio without closing the transport', async () => {
  const f = fixture()
  const transport = new f.Transport(() => {})
  transport.send(JSON.stringify({ type: 'session.commentary.append', text: 'session.close' }))
  assert.ok(!f.calls.includes('xs_live_audio_quiesce'))
  transport.send(JSON.stringify({ type: 'session.close' }))
  assert.equal(f.calls.filter((name) => name === 'xs_live_audio_quiesce').length, 1)
  assert.ok(!f.calls.includes('xs_live_transport_close'))
})
test('a callback exception propagates once without running a finally reschedule', async () => {
  const f = fixture()
  const failure = new Error('consumer failed')
  new f.Transport(() => {
    throw failure
  })
  f.events.push({ type: 'message', data: 'hello' })
  assert.throws(
    () => f.timers[0].callback(f.timers[0]),
    (error) => error === failure,
  )
  assert.equal(f.scheduled.length, 0)
})

test('blocked native sending has a bounded queue and rejects sends after close', async () => {
  const f = fixture()
  const transport = new f.Transport(() => {})
  for (let i = 0; i < 32; i++) transport.send('queued')
  assert.throws(() => transport.send('overflow'), /limit exceeded/)
  const closing = transport.close()
  assert.throws(() => transport.send('after close'), /closed/)
  f.events.push({ type: 'released' })
  f.timers[0].callback(f.timers[0])
  await closing
})

test('limits outgoing event bytes independently from the event count', async () => {
  const f = fixture()
  const transport = new f.Transport(() => {})
  assert.throws(() => transport.send('x'.repeat(65537)), /limit exceeded/)
  transport.send('x'.repeat(65536))
  transport.send('x'.repeat(65536))
  assert.throws(() => transport.send('x'), /limit exceeded/)
})

test('timer initialization failure releases native ownership before another constructor', () => {
  let owner,
    fail = true
  const calls = []
  const Transport = createTransport({
    Base: class {},
    Timer: {
      repeat() {
        if (fail) throw new Error('no timer')
        return {}
      },
    },
    native: (name) =>
      function () {
        calls.push(name)
        if (name === 'xs_live_transport_constructor') {
          assert.equal(owner, undefined)
          owner = this
        }
        if (name === 'xs_live_transport_release') {
          assert.equal(owner, this)
          owner = undefined
        }
      },
  })
  assert.throws(() => new Transport(() => {}), /no timer/)
  assert.deepEqual(calls, ['xs_live_transport_constructor', 'xs_live_transport_close', 'xs_live_transport_release'])
  fail = false
  assert.doesNotThrow(() => new Transport(() => {}))
})

test('failed native startup can close and release ownership before a fresh transport starts', async () => {
  let owner,
    fail = true,
    starts = 0,
    stopping = false
  const timers = []
  const Transport = createTransport({
    Base: class {},
    Timer: {
      repeat(callback) {
        const timer = { callback }
        timers.push(timer)
        return timer
      },
      clear(timer) {
        timer.cleared = true
      },
      schedule() {},
    },
    native: (name) =>
      function () {
        if (name === 'xs_live_transport_constructor') {
          if (owner) throw new Error('audio is in use')
          owner = this
          stopping = false
        }
        if (name === 'xs_live_transport_start') {
          if (fail) throw new Error('Realtime codec registration failed')
          starts++
        }
        if (name === 'xs_live_transport_close') stopping = true
        if (name === 'xs_live_transport_read' && stopping) return { type: 'released' }
        if (name === 'xs_live_transport_release') {
          assert.equal(owner, this)
          owner = undefined
        }
      },
  })
  const first = new Transport(() => {})
  assert.throws(() => first.start(), /codec registration failed/)
  assert.equal(starts, 0)
  assert.throws(() => new Transport(() => {}), /audio is in use/)
  const closing = first.close()
  timers[0].callback(timers[0])
  await closing
  assert.equal(owner, undefined)
  assert.ok(timers[0].cleared)
  fail = false
  const second = new Transport(() => {})
  second.start()
  assert.equal(starts, 1)
  const secondClose = second.close()
  timers[1].callback(timers[1])
  await secondClose
  assert.equal(owner, undefined)
})
