import assert from 'node:assert/strict'
import test from 'node:test'
import { createBackgroundFetch } from './http-dispatcher.js'

function fixture() {
  const workers = [],
    timers = []
  const fetch = createBackgroundFetch({
    createWorker() {
      const worker = {
        postMessage(message) {
          this.message = message
        },
        terminate() {
          this.closed = true
        },
      }
      workers.push(worker)
      return worker
    },
    schedule(callback, ms) {
      const timer = { callback, ms }
      timers.push(timer)
      return timer
    },
    cancel(timer) {
      timer.cancelled = true
    },
  })
  const reply = (worker, response) => worker.onmessage({ id: worker.message.id, ...response })
  const pump = () => {
    const timer = timers.find((timer) => timer.ms === 1 && !timer.ran)
    timer.ran = true
    timer.callback()
  }
  return { fetch, workers, timers, reply, pump }
}
test('prepare and successive requests share one worker and preserve HTTP status/body', async () => {
  const f = fixture()
  f.fetch.prepare()
  f.fetch.prepare()
  assert.equal(f.workers.length, 1)
  const one = f.fetch('https://service/one', { method: 'POST', body: 'a', headers: {} })
  const firstId = f.workers[0].message.id
  const two = f.fetch('https://service/two', { method: 'POST', body: 'b', headers: {} })
  f.reply(f.workers[0], { status: 429, body: 'retry later' })
  const response = await one
  assert.equal(response.ok, false)
  assert.equal(response.status, 429)
  assert.equal(await response.text(), 'retry later')
  f.pump()
  assert.equal(f.workers.length, 1)
  assert.equal(f.workers[0].message.url, 'https://service/two')
  f.workers[0].onmessage({ id: firstId, status: 400, body: 'duplicate' })
  f.reply(f.workers[0], { status: 200, body: 'ok' })
  assert.equal((await two).ok, true)
  f.pump()
  assert.ok(!f.workers[0].closed)
})
test('queueing counts towards the deadline without starting an expired request', async () => {
  const f = fixture()
  const one = f.fetch('https://service/one', { timeoutMs: 45000 })
  const two = f.fetch('https://service/two', { timeoutMs: 1000 })
  f.timers.find((timer) => timer.ms === 1000).callback()
  await assert.rejects(two, /timed out/)
  f.reply(f.workers[0], { status: 200, body: 'ok' })
  await one
  f.pump()
  assert.equal(f.workers.length, 1)
  assert.ok(!f.workers[0].closed)
})
test('an active timeout retires its worker; late replies cannot settle another request', async () => {
  const f = fixture()
  const pending = f.fetch('https://service/slow', { timeoutMs: 1000 })
  const next = f.fetch('https://service/next', { timeoutMs: 45000 })
  f.timers[0].callback()
  await assert.rejects(pending, /timed out/)
  f.reply(f.workers[0], { status: 200, body: 'late' })
  assert.equal(f.timers.filter((timer) => timer.ms === 1).length, 1)
  f.pump()
  assert.ok(f.workers[0].closed)
  assert.equal(f.workers.length, 2)
  f.reply(f.workers[1], { status: 201, body: 'next' })
  assert.equal((await next).status, 201)
  f.pump()
})

test('capacity includes the active request and all queued requests', async () => {
  const f = fixture()
  const pending = Array.from({ length: 8 }, (_, i) => f.fetch(`https://service/${i}`, {}))
  await assert.rejects(f.fetch('https://service/excess', {}), /capacity/)
  assert.equal(f.workers.length, 1)
  for (const request of pending) {
    f.reply(f.workers[0], { status: 200, body: 'ok' })
    await request
    f.pump()
  }
})

test('a backend failure retires the request before dispatching the next one', async () => {
  const f = fixture()
  const first = f.fetch('https://service/failure', {})
  const next = f.fetch('https://service/next', {})
  f.reply(f.workers[0], { error: { name: 'RangeError', message: 'response exceeds limit' } })
  await assert.rejects(first, { name: 'RangeError', message: 'response exceeds limit' })
  f.pump()
  assert.ok(f.workers[0].closed)
  assert.equal(f.workers.length, 2)
  f.reply(f.workers[1], { status: 200, body: 'recovered' })
  assert.equal(await (await next).text(), 'recovered')
  f.pump()
})

test('backend errors work with the read-only Error prototype used by XS preload', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(Error.prototype, 'name')
  try {
    Object.defineProperty(Error.prototype, 'name', { ...descriptor, writable: false })
    const f = fixture()
    const pending = f.fetch('https://service/failure', {})
    f.reply(f.workers[0], { error: { name: 'TypeError', message: 'invalid response' } })
    await assert.rejects(pending, { name: 'TypeError', message: 'invalid response' })
    f.pump()
    assert.ok(f.workers[0].closed)
  } finally {
    Object.defineProperty(Error.prototype, 'name', descriptor)
  }
})
