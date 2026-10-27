import assert from 'node:assert/strict'
import test from 'node:test'
import { createHttpQueue } from '../http-queue.js'

test('undeliverable replies expire and release the next queued request', async () => {
  let now = 100,
    blocked = true
  const timers = [],
    executed = [],
    replies = []
  const queue = createHttpQueue({
    execute: async (request) => {
      executed.push(request)
      return { status: 200 }
    },
    post: (message) => {
      if (blocked) throw new Error('full')
      replies.push(message)
    },
    schedule: (callback, ms) => timers.push({ callback, ms }),
    elapsed: (started) => (now - started) >>> 0,
  })
  const first = queue({ id: 1, started: 0, request: { timeoutMs: 1000 } })
  await new Promise(setImmediate)
  assert.equal(executed[0].timeoutMs, 900)
  const second = queue({ id: 2, started: 100, request: { timeoutMs: 2000 } })
  now = 1000
  blocked = false
  timers.shift().callback()
  await Promise.all([first, second])
  assert.deepEqual(
    replies.map((m) => m.id),
    [2],
  )
  assert.equal(executed[1].timeoutMs, 1100)
  assert.equal(timers.length, 0)
})

test('expired queued jobs never start and timer allocation failures do not poison the queue', async () => {
  const executed = []
  const queue = createHttpQueue({
    execute: async (request) => {
      executed.push(request)
      throw new Error('network')
    },
    post: () => {
      throw new Error('full')
    },
    schedule: () => {
      throw new Error('no timer')
    },
    elapsed: (started) => (10 - started) >>> 0,
  })
  await queue({ id: 1, started: 0, request: { timeoutMs: 1 } })
  assert.equal(executed.length, 0)
  await queue({ id: 2, started: 0xfffffff0, request: { timeoutMs: 1000 } })
  await queue({ id: 3, started: 0, request: { timeoutMs: 1000 } })
  assert.deepEqual(
    executed.map((r) => r.timeoutMs),
    [974, 990],
  )
})

test('idle is acknowledged only after execution cleanup and the complete delivered batch', async () => {
  const completed = [],
    replies = [],
    idle = []
  let finish
  const queue = createHttpQueue({
    execute(request) {
      return new Promise((resolve) => {
        finish = () => {
          completed.push(request.path)
          resolve({ status: 200 })
        }
      })
    },
    post: (message) => replies.push(message),
    onIdle(id) {
      assert.equal(completed.length, 2)
      assert.equal(replies.length, 2)
      idle.push(id)
    },
    schedule: () => assert.fail('no retry needed'),
    elapsed: () => 0,
  })
  const first = queue({ id: 1, started: 0, request: { path: '/first', timeoutMs: 1000 } })
  await new Promise(setImmediate)
  const second = queue({ id: 2, started: 0, request: { path: '/second', timeoutMs: 1000 } })
  assert.deepEqual(idle, [])
  finish()
  await first
  assert.deepEqual(idle, [])
  await new Promise(setImmediate)
  finish()
  await second
  assert.deepEqual(idle, [2])
})

test('idle IPC retries are invalidated by newer work and include capacity rejected deliveries', async () => {
  const timers = [],
    idle = [],
    replies = []
  let blocked = true,
    finish
  const queue = createHttpQueue({
    execute: () => new Promise((resolve) => (finish = () => resolve({ status: 200 }))),
    post: (message) => replies.push(message),
    onIdle(id) {
      if (blocked) throw new Error('IPC full')
      idle.push(id)
    },
    schedule: (callback) => timers.push(callback),
    elapsed: () => 0,
  })
  const first = queue({ id: 1, started: 0, request: { timeoutMs: 1000 } })
  await new Promise(setImmediate)
  finish()
  await first
  assert.equal(timers.length, 1)
  const second = queue({ id: 2, started: 0, request: { timeoutMs: 1000 } })
  blocked = false
  timers.shift()()
  assert.deepEqual(idle, [], 'stale idle retry cannot acknowledge the second request')
  await new Promise(setImmediate)
  const requests = [second]
  for (let id = 3; id <= 9; id++) requests.push(queue({ id, started: 0, request: { timeoutMs: 1000 } }))
  queue({ id: 10, started: 0, request: { timeoutMs: 1000 } })
  assert.equal(replies.at(-1).id, 10)
  assert.match(replies.at(-1).error, /capacity/)
  for (const request of requests) {
    finish()
    await request
    await new Promise(setImmediate)
  }
  assert.deepEqual(idle, [10], 'all received IDs are acknowledged, including a rejected request')
  assert.equal(timers.length, 0)
})
