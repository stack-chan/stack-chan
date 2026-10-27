import assert from 'node:assert/strict'
import test from 'node:test'
import { createHttpProxy } from '../http-proxy.js'

function fixture() {
  const workers = [],
    timers = new Set()
  let failCreation = false,
    failPost = false,
    failTimer = false
  const fetch = createHttpProxy({
    createWorker() {
      if (failCreation) throw new Error('worker allocation failed')
      const worker = {
        sent: [],
        terminated: 0,
        postMessage(message) {
          assert.equal(this.terminated, 0)
          if (failPost) throw new Error('IPC queue full')
          this.sent.push(message)
        },
      }
      workers.push(worker)
      return worker
    },
    releaseWorker(worker) {
      worker.terminated++
    },
    normalize(url) {
      if (!url.startsWith('https://')) throw new URIError('HTTPS required')
      return { timeoutMs: 1000 }
    },
    decode: (value) => value,
    schedule(callback) {
      if (failTimer) throw new Error('timer allocation failed')
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
    set failPost(value) {
      failPost = value
    },
    set failTimer(value) {
      failTimer = value
    },
    respond(index, body = 'ok', workerIndex = 0) {
      const worker = workers[workerIndex]
      worker.onmessage({ id: worker.sent[index].id, status: 200, body })
    },
    idle(workerIndex = 0, id = workers[workerIndex].sent.at(-1)?.id) {
      workers[workerIndex].onmessage({ idle: id })
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

test('idle acknowledgement releases the Worker and the next request creates a new VM', async () => {
  const f = fixture()
  const request = f.fetch('https://service.test/first')
  const oldMessage = f.workers[0].onmessage
  f.respond(0, 'first')
  assert.equal(await (await request).text(), 'first')
  assert.equal(f.workers[0].terminated, 0, 'a reply alone does not establish Worker quiescence')
  f.idle()
  assert.equal(f.workers[0].terminated, 1)
  const next = f.fetch('https://service.test/next')
  assert.equal(f.workers.length, 2)
  oldMessage({ idle: f.workers[0].sent[0].id })
  oldMessage({ id: f.workers[1].sent[0].id, error: 'stale VM' })
  assert.equal(f.workers[1].terminated, 0)
  f.respond(0, 'next', 1)
  assert.equal(await (await next).text(), 'next')
  f.idle(1)
  assert.equal(f.workers[1].terminated, 1)
  assert.equal(f.timers.size, 0)
})

test('a new request invalidates an older idle acknowledgement even after caller deadlines expire', async () => {
  const f = fixture()
  const first = f.fetch('https://service.test/first')
  f.respond(0)
  await first
  const second = f.fetch('https://service.test/second')
  const rejection = assert.rejects(second, /timed out/)
  const timer = [...f.timers][0]
  f.timers.delete(timer)
  timer()
  await rejection
  f.idle(0, f.workers[0].sent[0].id)
  assert.equal(f.workers[0].terminated, 0, 'the timed out second request can still own TLS state')
  f.respond(1, 'late')
  assert.equal(f.workers[0].terminated, 0)
  f.idle()
  assert.equal(f.workers[0].terminated, 1)
})

test('shared concurrent requests survive idle messages until the complete posted batch finishes', async () => {
  const f = fixture()
  const first = f.fetch('https://service.test/first')
  const second = f.fetch('https://service.test/second')
  f.respond(0)
  await first
  f.idle()
  assert.equal(f.workers[0].terminated, 0)
  f.respond(1)
  await second
  f.idle()
  f.idle()
  assert.equal(f.workers[0].terminated, 1, 'duplicate old messages cannot terminate twice')
})

test('failed initial IPC or deadline timer allocation releases an unused VM and can retry', async () => {
  for (const failure of ['failPost', 'failTimer']) {
    const f = fixture()
    f[failure] = true
    await assert.rejects(f.fetch('https://service.test/first'), /full|allocation/)
    assert.equal(f.workers[0].terminated, 1)
    assert.equal(f.timers.size, 0)
    f[failure] = false
    const retry = f.fetch('https://service.test/retry')
    f.respond(0, 'retry', 1)
    assert.equal(await (await retry).text(), 'retry')
    f.idle(1)
    assert.equal(f.workers[1].terminated, 1)
  }
})

test('failed IPC on a used Worker waits for its acknowledged work to finish', async () => {
  const f = fixture()
  const first = f.fetch('https://service.test/first')
  f.failPost = true
  await assert.rejects(f.fetch('https://service.test/second'), /full/)
  assert.equal(f.workers[0].terminated, 0)
  f.respond(0)
  await first
  f.idle()
  assert.equal(f.workers[0].terminated, 1)
})
