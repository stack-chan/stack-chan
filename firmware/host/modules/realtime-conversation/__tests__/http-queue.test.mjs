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
