import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { writeAliasPackageSubpath } from '../modules/testing/node-alias-package.js'

async function setup() {
  const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  writeAliasPackageSubpath(hostRoot, 'stackchan', 'errors', resolve(hostRoot, '../sdk/errors.js'))
  return import('./operation-queue.js')
}

async function flush(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) await Promise.resolve()
}

class Clock {
  now = 0
  jobs = new Set<{ due: number; callback: () => void }>()
  after(ms: number, callback: () => void): () => void {
    const job = { due: this.now + ms, callback }
    this.jobs.add(job)
    return () => {
      this.jobs.delete(job)
    }
  }
  advance(ms: number): void {
    this.now += ms
    for (const job of [...this.jobs]) {
      if (job.due <= this.now && this.jobs.delete(job)) job.callback()
    }
  }
}

test('queue serializes work, bounds waiting jobs, and releases deadline timers', async () => {
  const { OperationQueue } = await setup()
  const clock = new Clock()
  const queue = new OperationQueue({ clock, capacity: 1 })
  const calls: string[] = []
  let finish: (value: number) => void
  const first = queue.run(() => {
    calls.push('first')
    return new Promise<number>((resolve) => {
      finish = resolve
    })
  })
  const second = queue.run(() => {
    calls.push('second')
    return 2
  })
  await assert.rejects(
    queue.run(() => 3),
    { code: 'BUSY' },
  )
  assert.deepEqual(calls, ['first'])
  finish(1)
  assert.deepEqual(await Promise.all([first, second]), [1, 2])
  assert.deepEqual(calls, ['first', 'second'])
  assert.equal(queue.size, 0)
  assert.equal(clock.jobs.size, 0)
})

test('queue close settles active and waiting work even when provider completes late', async () => {
  const { OperationQueue } = await setup()
  const clock = new Clock()
  const queue = new OperationQueue({ clock })
  let finish: () => void
  let cancelled = 0
  let queuedStarts = 0
  const first = queue.run(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
    () => {
      cancelled += 1
    },
  )
  const second = queue.run(() => {
    queuedStarts += 1
  })
  queue.close()
  queue.close()
  await assert.rejects(first, { code: 'CLOSED' })
  await assert.rejects(second, { code: 'CLOSED' })
  finish()
  await Promise.resolve()
  assert.equal(queuedStarts, 0)
  assert.equal(cancelled, 1)
  assert.equal(queue.size, 0)
  assert.equal(clock.jobs.size, 0)
  await assert.rejects(
    queue.run(() => 0),
    { code: 'CLOSED' },
  )
})

test('waiting deadline does not start or cancel a provider', async () => {
  const { OperationQueue } = await setup()
  const clock = new Clock()
  const queue = new OperationQueue({ clock, waitTimeoutMs: 10, operationTimeoutMs: 100 })
  let cancelled = 0
  let starts = 0
  const active = queue.run(() => new Promise<void>(() => {}))
  const waiting = queue.run(
    () => {
      starts += 1
    },
    () => {
      cancelled += 1
    },
  )
  clock.advance(10)
  await assert.rejects(waiting, { code: 'TIMEOUT' })
  assert.equal(starts, 0)
  assert.equal(cancelled, 0)
  queue.close()
  await assert.rejects(active, { code: 'CLOSED' })
  assert.equal(clock.jobs.size, 0)
})

test('stalled operations time out and cancellation failure prevents unsafe reuse', async () => {
  const { OperationQueue } = await setup()
  const clock = new Clock()
  const queue = new OperationQueue({ clock, operationTimeoutMs: 10 })
  let starts = 0
  const active = queue.run(
    () => new Promise<void>(() => {}),
    () => {
      throw new Error('output cannot close')
    },
  )
  const waiting = queue.run(() => {
    starts += 1
  })
  clock.advance(10)
  await assert.rejects(active, { code: 'TIMEOUT' })
  await assert.rejects(waiting, { code: 'IO' })
  assert.equal(starts, 0)
  assert.equal(queue.closed, true)
  assert.equal(queue.size, 0)
  assert.equal(clock.jobs.size, 0)
})

test('100 operation and close cycles retain no resource deadlines', async () => {
  const { OperationQueue } = await setup()
  const clock = new Clock()
  for (let cycle = 0; cycle < 100; cycle += 1) {
    const queue = new OperationQueue({ clock })
    await queue.run(() => 1)
    await assert.rejects(
      queue.run(() => {
        throw new Error('provider failure')
      }),
      { code: 'IO' },
    )
    queue.close()
    assert.equal(queue.size, 0)
    assert.equal(clock.jobs.size, 0)
  }
})

test('asynchronous cancellation holds the resource until stop acknowledgement, ignoring late success', async () => {
  const { OperationQueue } = await setup()
  const { CancellationSource } = await import('./cancellation.js')
  const source = new CancellationSource()
  const clock = new Clock()
  const queue = new OperationQueue({ clock })
  const calls: string[] = []
  let finishProvider: () => void
  let finishStop: () => void
  const active = queue.run(
    () =>
      new Promise<void>((resolve) => {
        finishProvider = resolve
      }),
    () => {
      calls.push('stop')
      return new Promise<void>((resolve) => {
        finishStop = resolve
      })
    },
    source.signal,
  )
  const rejected = assert.rejects(active, { code: 'CANCELLED' })
  const waiting = queue.run(() => {
    calls.push('next')
  })
  source.cancel()
  source.cancel()
  const oldDeadlines = [...clock.jobs].map((job) => job.callback)
  finishProvider()
  await flush()
  assert.deepEqual(calls, ['stop'])
  assert.equal(queue.size, 2)
  assert.equal(source.size, 0)
  finishStop()
  await rejected
  await waiting
  for (const expired of oldDeadlines) expired()
  assert.deepEqual(calls, ['stop', 'next'])
  assert.equal(clock.jobs.size, 0)
  assert.equal(queue.closed, false, 'a cleared stop deadline cannot fault the next operation')
  await queue.close()
})

test('asynchronous stop failure faults waiting work and remains observable from close', async () => {
  const { OperationQueue } = await setup()
  const clock = new Clock()
  const queue = new OperationQueue({ clock, operationTimeoutMs: 10 })
  let rejectStop: (error: unknown) => void
  const active = queue.run(
    () => new Promise<void>(() => {}),
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectStop = reject
      }),
  )
  const activeFailure = assert.rejects(active, { code: 'TIMEOUT' })
  let starts = 0
  const waiting = queue.run(() => {
    starts += 1
  })
  const waitingFailure = assert.rejects(waiting, { code: 'IO', message: 'motor did not stop' })
  clock.advance(10)
  await flush()
  assert.equal(queue.closed, false)
  rejectStop(new Error('motor did not stop'))
  await Promise.all([activeFailure, waitingFailure])
  assert.equal(starts, 0)
  assert.equal(queue.closed, true)
  const close = queue.close()
  assert.equal(close, queue.close())
  await assert.rejects(close, { code: 'IO', message: 'motor did not stop' })
  assert.equal(clock.jobs.size, 0)
})

test('a stalled stop has its own deadline and late acknowledgement cannot revive a faulted queue', async () => {
  const { OperationQueue } = await setup()
  const clock = new Clock()
  const queue = new OperationQueue({ clock, operationTimeoutMs: 10, cancellationTimeoutMs: 20 })
  let finishStop: () => void
  let starts = 0
  const active = queue.run(
    () => new Promise<void>(() => {}),
    () =>
      new Promise<void>((resolve) => {
        finishStop = resolve
      }),
  )
  const activeFailure = assert.rejects(active, { code: 'TIMEOUT' })
  const waiting = queue.run(() => {
    starts += 1
  })
  const waitingFailure = assert.rejects(waiting, { code: 'TIMEOUT', message: /Resource stop/ })
  clock.advance(10)
  clock.advance(19)
  assert.equal(queue.size, 2)
  assert.equal(starts, 0)
  clock.advance(1)
  await Promise.all([activeFailure, waitingFailure])
  finishStop()
  await flush()
  await assert.rejects(
    queue.run(() => {
      starts += 1
    }),
    { code: 'CLOSED' },
  )
  await assert.rejects(queue.close(), { code: 'TIMEOUT', message: /Resource stop/ })
  assert.equal(starts, 0)
  assert.equal(queue.size, 0)
  assert.equal(clock.jobs.size, 0)
})

test('reentrant close shares its completion and awaits an already running stop', async () => {
  const { OperationQueue } = await setup()
  const clock = new Clock()
  const queue = new OperationQueue({ clock })
  let stop: () => void
  let nestedClose: Promise<void> | undefined
  let stops = 0
  let closed = false
  const active = queue.run(
    () => new Promise<void>(() => {}),
    () => {
      stops += 1
      nestedClose = queue.close()
      return new Promise<void>((resolve) => {
        stop = resolve
      })
    },
  )
  const activeFailure = assert.rejects(active, { code: 'CLOSED' })
  const close = queue.close()
  void close.then(() => {
    closed = true
  })
  assert.equal(close, nestedClose)
  await flush()
  assert.equal(closed, false)
  stop()
  await close
  await activeFailure
  assert.equal(closed, true)
  assert.equal(stops, 1)
  assert.equal(clock.jobs.size, 0)
})

test('waiting operations can expire while a cancelled operation is still stopping', async () => {
  const { OperationQueue } = await setup()
  const clock = new Clock()
  const queue = new OperationQueue({ clock, operationTimeoutMs: 10, waitTimeoutMs: 15 })
  let stop: () => void
  let starts = 0
  const active = queue.run(
    () => new Promise<void>(() => {}),
    () =>
      new Promise<void>((resolve) => {
        stop = resolve
      }),
  )
  const activeFailure = assert.rejects(active, { code: 'TIMEOUT' })
  const waiting = queue.run(() => {
    starts += 1
  })
  const waitingFailure = assert.rejects(waiting, { code: 'TIMEOUT', message: /waiting/ })
  clock.advance(10)
  clock.advance(5)
  await waitingFailure
  assert.equal(queue.size, 1)
  stop()
  await activeFailure
  assert.equal(starts, 0)
  assert.equal(queue.closed, false)
  await queue.run(() => {
    starts += 1
  })
  assert.equal(starts, 1)
  await queue.close()
})

test('stop deadline scheduling failure attempts cleanup and prevents reuse', async () => {
  const { OperationQueue } = await setup()
  const clock = new Clock()
  const queue = new OperationQueue({ clock, operationTimeoutMs: 10 })
  let rejectStop: (error: unknown) => void
  const active = queue.run(
    () => new Promise<void>(() => {}),
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectStop = reject
      }),
  )
  const activeFailure = assert.rejects(active, { code: 'TIMEOUT' })
  clock.after = () => {
    throw new Error('no timer available')
  }
  clock.advance(10)
  await activeFailure
  rejectStop(new Error('late stop failure'))
  await flush()
  await assert.rejects(queue.close(), { code: 'IO', message: 'no timer available' })
  assert.equal(queue.closed, true)
  assert.equal(clock.jobs.size, 0)
})
