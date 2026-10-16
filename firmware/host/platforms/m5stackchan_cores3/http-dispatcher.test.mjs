import assert from 'node:assert/strict'
import test from 'node:test'
import { createBackgroundFetch } from './http-dispatcher.js'
import { normalizeRequest } from './http-request-options.js'

function fixture(available = true) {
  const requests = [],
    timers = []
  const fetch = createBackgroundFetch({
    createRequest() {
      const request = {
        starts: [],
        available,
        start(...args) {
          this.starts.push(args)
          return this.available
        },
        read() {
          const next = this.next
          this.next = undefined
          if (next instanceof Error) throw next
          return next
        },
        close() {
          this.closed = true
        },
      }
      requests.push(request)
      return request
    },
    normalize: (url, options) => normalizeRequest(url, options, (text) => new TextEncoder().encode(text).buffer),
    decode: (body) => body,
    schedule(callback, ms) {
      const timer = { callback, ms }
      timers.push(timer)
      return timer
    },
    cancel(timer) {
      if (timer) timer.cancelled = true
    },
  })
  const tick = (ms) => {
    const timer = timers.find((t) => t.ms === ms && !t.ran && !t.cancelled)
    assert.ok(timer, `pending timer ${ms}`)
    timer.ran = true
    timer.callback()
    return timer
  }
  const reply = (request, response) => {
    request.next = response
    tick(25)
  }
  const post = (path, options = {}) => fetch(`https://service/${path}`, { method: 'POST', ...options })
  return { fetch, post, requests, timers, tick, reply }
}

test('successive requests reuse the native handle and preserve status, body and connection metadata', async () => {
  const f = fixture()
  const one = f.post('one', { keepAlive: true }),
    two = f.post('two')
  f.reply(f.requests[0], { status: 429, body: 'retry later' })
  const response = await one
  assert.equal(response.ok, false)
  assert.equal(await response.text(), 'retry later')
  f.tick(1)
  assert.equal(f.requests.length, 1)
  assert.equal(f.requests[0].starts.at(-1)[0], 'https://service/two')
  f.reply(f.requests[0], { status: 200, body: 'ok', connectionReused: true })
  assert.equal((await two).connectionReused, true)
  assert.ok(!f.requests[0].closed)
})
test('queue time counts toward the deadline and an expired request never starts', async () => {
  const f = fixture(),
    one = f.post('one'),
    two = f.post('two', { timeoutMs: 1000 })
  f.tick(1000)
  await assert.rejects(two, /timed out/)
  f.reply(f.requests[0], { status: 200, body: '' })
  await one
  f.tick(1)
  assert.equal(f.requests[0].starts.length, 1)
})
test('active cancellation closes the native handle and late polls cannot complete another request', async () => {
  const f = fixture(),
    first = f.post('slow', { timeoutMs: 1000 }),
    next = f.post('next')
  const stale = f.timers.find((t) => t.ms === 25)
  f.tick(1000)
  await assert.rejects(first, /timed out/)
  assert.equal(f.requests[0].closed, true)
  f.tick(1)
  f.requests[0].next = { status: 200, body: 'late' }
  stale.callback()
  f.reply(f.requests[1], { status: 201, body: 'next' })
  assert.equal(await (await next).text(), 'next')
})
test('capacity includes the active request and every queued request', async () => {
  const f = fixture(),
    pending = Array.from({ length: 8 }, (_, i) => f.post(String(i)))
  await assert.rejects(f.post('overflow'), /capacity/)
  for (const p of pending) {
    f.reply(f.requests[0], { status: 200, body: '' })
    await p
    f.tick(1)
  }
})
test('native errors retire the handle before another request starts', async () => {
  const f = fixture(),
    first = f.post('failure'),
    next = f.post('next')
  f.reply(f.requests[0], { errorCode: 2, status: 200, transportError: -1 })
  await assert.rejects(first, /response exceeds limit/)
  assert.equal(f.requests[0].closed, true)
  f.tick(1)
  f.reply(f.requests[1], { status: 200, body: 'ok' })
  assert.equal(await (await next).text(), 'ok')
})
test('keep-alive handles expire after idle time and a new request cancels idle expiry', async () => {
  const f = fixture(),
    first = f.post('one', { keepAlive: true })
  f.reply(f.requests[0], { status: 200, body: '' })
  await first
  const second = f.post('two', { keepAlive: true })
  assert.equal(f.timers.find((t) => t.ms === 3000).cancelled, true)
  f.reply(f.requests[0], { status: 200, body: '' })
  await second
  f.tick(3000)
  assert.equal(f.requests[0].closed, true)
  const third = f.post('three')
  f.reply(f.requests[1], { status: 200, body: '' })
  await third
})
test('global native occupancy retries without issuing duplicate starts after acceptance', async () => {
  const f = fixture(false),
    pending = f.post('busy')
  f.tick(25)
  assert.equal(f.requests[0].starts.length, 2)
  f.requests[0].available = true
  f.tick(25)
  f.tick(25)
  assert.equal(f.requests[0].starts.length, 3)
  f.reply(f.requests[0], { status: 200, body: '' })
  await pending
})
test('validation failures do not occupy the queue or allocate a native request', async () => {
  const f = fixture()
  await assert.rejects(f.fetch('http://insecure/one', { method: 'POST' }), /Invalid Live endpoint/)
  await assert.rejects(f.post('header', { headers: { Authorization: 'Bearer x\r\ny' } }), /Invalid Live header/)
  assert.equal(f.requests.length, 0)
})
