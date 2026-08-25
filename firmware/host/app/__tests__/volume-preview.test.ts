import assert from 'node:assert/strict'
import { test } from 'node:test'

import { VolumePreviewQueue } from '../volume-preview.js'

type Deferred = {
  promise: Promise<void>
  resolve(): void
}

function deferred(): Deferred {
  let resolve = () => undefined
  const promise = new Promise<void>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

test('closing drops pending previews while waiting for active playback', async () => {
  const first = deferred()
  const played: number[] = []
  const queue = new VolumePreviewQueue({
    play: (volume) => {
      played.push(volume)
      return played.length === 1 ? first.promise : Promise.resolve()
    },
  })

  queue.request(0.2)
  queue.request(0.4)
  queue.request(0.8)
  await flushPromises()
  assert.deepEqual(played, [0.2])

  first.resolve()
  await queue.close()
  assert.deepEqual(played, [0.2])
})

test('the latest pending preview starts after active playback finishes', async () => {
  const first = deferred()
  const secondStarted = deferred()
  const played: number[] = []
  const queue = new VolumePreviewQueue({
    play: (volume) => {
      played.push(volume)
      if (played.length === 2) secondStarted.resolve()
      return played.length === 1 ? first.promise : Promise.resolve()
    },
  })

  queue.request(0.1)
  queue.request(0.5)
  queue.request(0.9)
  await flushPromises()
  first.resolve()
  await secondStarted.promise
  assert.deepEqual(played, [0.1, 0.9])
  await queue.close()
})

test('playback failures are reported without blocking the next preview', async () => {
  const played: number[] = []
  const errors: unknown[] = []
  const queue = new VolumePreviewQueue({
    play: async (volume) => {
      played.push(volume)
      if (played.length === 1) throw new Error('audio unavailable')
    },
    onError: (error) => {
      errors.push(error)
      throw new Error('reporting failed')
    },
  })

  queue.request(0.3)
  queue.request(0.7)
  await flushPromises()
  await flushPromises()
  assert.deepEqual(played, [0.3, 0.7])
  assert.equal(errors.length, 1)
  await queue.close()
})

test('closing waits for active playback and ignores later requests', async () => {
  const active = deferred()
  const played: number[] = []
  const queue = new VolumePreviewQueue({
    play: (volume) => {
      played.push(volume)
      return active.promise
    },
  })

  queue.request(0.6)
  await flushPromises()
  let closed = false
  const closing = queue.close().then(() => {
    closed = true
  })
  queue.request(0.9)
  await flushPromises()
  assert.equal(closed, false)
  assert.deepEqual(played, [0.6])

  active.resolve()
  await closing
  assert.equal(closed, true)
  assert.deepEqual(played, [0.6])
})
