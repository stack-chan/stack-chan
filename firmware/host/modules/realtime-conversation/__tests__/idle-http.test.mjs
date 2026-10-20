import assert from 'node:assert/strict'
import test from 'node:test'
import { createHttpProxy } from '../http-proxy.js'

function fixture() {
  const workers = [],
    timers = new Set()
  let failCreation = false
  const fetch = createHttpProxy({
    createWorker() {
      if (failCreation) throw new Error('worker allocation failed')
      const worker = {
        sent: [],
        postMessage(message) {
          this.sent.push(message)
        },
      }
      workers.push(worker)
      return worker
    },
    normalize(url) {
      if (!url.startsWith('https://')) throw new URIError('HTTPS required')
      return { timeoutMs: 1000 }
    },
    decode: (value) => value,
    schedule(callback) {
      timers.add(callback)
      return callback
    },
    cancel: (timer) => timers.delete(timer),
    now: () => 10,
  })
  return {
    fetch,
    workers,
    timers,
    set failCreation(value) {
      failCreation = value
    },
    respond(index, body = 'ok') {
      const worker = workers[0]
      worker.onmessage({ id: worker.sent[index].id, status: 200, body })
    },
  }
}

test('an unused HTTP capability consumes no worker or timer and rejects invalid requests without allocation', async () => {
  const f = fixture()
  assert.equal(f.workers.length, 0)
  assert.equal(f.timers.size, 0)
  await assert.rejects(f.fetch('http://service.test'), URIError)
  assert.equal(f.workers.length, 0)
  assert.equal(f.timers.size, 0)
})

test('concurrent valid requests share one lazily created worker and route out-of-order responses', async () => {
  const f = fixture()
  const first = f.fetch('https://service.test/first')
  const second = f.fetch('https://service.test/second')
  assert.equal(f.workers.length, 1)
  assert.equal(f.timers.size, 2)
  f.respond(1, 'second')
  assert.equal(await (await second).text(), 'second')
  assert.equal(f.timers.size, 1)
  f.respond(0, 'first')
  assert.equal(await (await first).text(), 'first')
  assert.equal(f.timers.size, 0)
  const third = f.fetch('https://service.test/third')
  assert.equal(f.workers.length, 1)
  f.respond(2, 'third')
  assert.equal(await (await third).text(), 'third')
  assert.equal(f.timers.size, 0)
})

test('worker allocation failure leaves the HTTP capability usable for a later request', async () => {
  const f = fixture()
  f.failCreation = true
  await assert.rejects(f.fetch('https://service.test/first'), /worker allocation failed/)
  assert.equal(f.workers.length, 0)
  assert.equal(f.timers.size, 0)
  f.failCreation = false
  const request = f.fetch('https://service.test/retry')
  f.respond(0)
  assert.equal((await request).ok, true)
  assert.equal(f.timers.size, 0)
})
