import assert from 'node:assert/strict'
import test from 'node:test'
import { createTransport } from '../transport-core.js'

test('a continuous native event backlog yields between polls and completes without loss', async () => {
  const backlog = Array.from({ length: 1000 }, (_, index) => ({ type: 'message', data: index }))
  const seen = [],
    timers = []
  let nativeClosed = false,
    releases = 0,
    scheduled = 0,
    cleared = false
  const Transport = createTransport({
    Base: class {},
    ArrayBuffer,
    Timer: {
      repeat(callback) {
        timers.push(callback)
        return callback
      },
      schedule() {
        scheduled++
      },
      clear() {
        cleared = true
      },
    },
    native: (name) => () => {
      if (name === 'xs_live_transport_read') {
        if (nativeClosed && !backlog.length) return { type: 'released' }
        return backlog.shift()
      }
      if (name === 'xs_live_transport_close') nativeClosed = true
      if (name === 'xs_live_transport_release') releases++
      if (name === 'xs_live_transport_stats') return { received: seen.length }
    },
  })
  const transport = new Transport((event) => seen.push(event.data))
  timers[0](timers[0])
  assert.ok(seen.length > 0)
  assert.ok(backlog.length > 0, 'one poll must yield even while native events remain available')
  assert.equal(scheduled, 1, 'the remaining backlog must get another event-loop turn')
  while (backlog.length) timers[0](timers[0])
  assert.deepEqual(
    seen,
    Array.from({ length: 1000 }, (_, index) => index),
  )
  const closing = transport.close()
  timers[0](timers[0])
  await closing
  assert.equal(cleared, true)
  assert.equal(releases, 1)
  assert.deepEqual(transport.stats, { received: seen.length })
})
