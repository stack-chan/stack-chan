import assert from 'node:assert/strict'
import test from 'node:test'
import { createHttpProxy } from '../http-proxy.js'
import { createHttpQueue } from '../http-queue.js'

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

test('an idle acknowledgement received before the final caller deadline is retained until that deadline', async () => {
  const f = fixture()
  const request = f.fetch('https://service.test/expired')
  const rejection = assert.rejects(request, /timed out/)
  f.idle()
  assert.equal(f.workers[0].terminated, 0)
  const timer = [...f.timers][0]
  f.timers.delete(timer)
  timer()
  await rejection
  assert.equal(f.workers[0].terminated, 1)
  const next = f.fetch('https://service.test/next')
  assert.equal(f.workers.length, 2)
  f.respond(0, 'next', 1)
  await next
  f.idle(1)
  assert.equal(f.workers[1].terminated, 1)
})

test('new posted work invalidates a remembered idle acknowledgement before later caller timeouts', async () => {
  const f = fixture()
  const first = f.fetch('https://service.test/first')
  const firstRejection = assert.rejects(first, /timed out/)
  f.idle()
  const second = f.fetch('https://service.test/second')
  const secondRejection = assert.rejects(second, /timed out/)
  for (const timer of [...f.timers]) {
    f.timers.delete(timer)
    timer()
  }
  await Promise.all([firstRejection, secondRejection])
  assert.equal(f.workers[0].terminated, 0, 'new HTTPS work is not covered by the remembered acknowledgement')
  f.idle(0, f.workers[0].sent[0].id)
  assert.equal(f.workers[0].terminated, 0, 'a stale acknowledgement cannot restore invalidated idle state')
  f.idle()
  assert.equal(f.workers[0].terminated, 1)
})

test('queue expiry without a reply releases the idle Worker after the later caller timer runs', async () => {
  const timers = new Set()
  let deliver,
    terminated = 0
  const worker = {}
  const queue = createHttpQueue({
    execute: () => assert.fail('expired work cannot start TLS'),
    post: () => assert.fail('expired work has no response to deliver'),
    onIdle: (id) => worker.onmessage({ idle: id }),
    schedule: () => assert.fail('idle acknowledgement does not need a retry'),
    elapsed: () => 1001,
  })
  worker.postMessage = (message) => {
    deliver = () => queue(message)
  }
  const fetch = createHttpProxy({
    createWorker: () => worker,
    releaseWorker: () => terminated++,
    normalize: () => ({ timeoutMs: 1000 }),
    decode: (body) => body,
    now: () => 0,
    schedule: (callback) => {
      timers.add(callback)
      return callback
    },
    cancel: (timer) => timers.delete(timer),
  })
  const request = fetch('https://service.test/expired')
  const rejection = assert.rejects(request, /timed out/)
  await deliver()
  assert.equal(terminated, 0, 'the caller still owns an unsettled request')
  const timer = [...timers][0]
  timers.delete(timer)
  timer()
  await rejection
  assert.equal(terminated, 1, 'the earlier idle acknowledgement survives until caller cleanup')
  assert.equal(timers.size, 0)
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
  assert.equal(f.workers[0].terminated, 1, 'the remembered acknowledgement is reconsidered after the response')
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
