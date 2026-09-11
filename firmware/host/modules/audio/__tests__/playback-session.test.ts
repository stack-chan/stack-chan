import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { writeAliasPackageSubpath } from '../../testing/node-alias-package.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
writeAliasPackageSubpath(root, 'stackchan', 'errors', resolve(root, '../../sdk/errors.js'))
const { beginPlaybackSession, createPlaybackSession, PlaybackProvider, playbackReleaseFailure } = await import(
  '../tts-playback-session.js'
)
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}
const drain = () => new Promise<void>((resolve) => setImmediate(resolve))

test('playback holds resources through synchronous construction and releases them once across 100 cycles', async () => {
  const owner = new PlaybackProvider()
  for (let cycle = 0; cycle < 100; cycle++) {
    const order: string[] = []
    const session = createPlaybackSession(owner, (error) => {
      assert.equal(error, undefined)
      order.push('completed')
    })
    session.addCleanup(() => {
      order.push('audio')
    })
    session.onDone()
    session.addCleanup(() => {
      order.push('constructor result')
    })
    assert.equal(owner.streaming, true)
    assert.deepEqual(order, [], 'native callback and resource constructor return before cleanup')
    session.onDone()
    await session.released
    assert.equal(owner.streaming, false)
    assert.deepEqual(order, ['constructor result', 'audio', 'completed'])
  }
  await owner.close()
})

test('cancellation waits for the streamer to stop before releasing its output', async () => {
  const owner = new PlaybackProvider()
  const release = deferred()
  const order: string[] = []
  let result: unknown
  const session = createPlaybackSession(owner, (error) => {
    result = error
    order.push('completed')
  })
  session.addCleanup(() => {
    order.push('audio')
  })
  session.addCleanup(() => {
    order.push('streamer')
    return release.promise
  })
  const reason = new Error('app stopped')
  const cancelled = session.cancel(reason)
  await drain()
  assert.deepEqual(order, ['streamer'], 'output remains alive until its writer has stopped')
  assert.equal(owner.streaming, true)
  assert.equal(result, undefined)
  let busy: unknown
  assert.equal(
    beginPlaybackSession(owner, (error) => {
      busy = error
    }),
    undefined,
  )
  assert.equal((busy as { code: string }).code, 'BUSY')
  release.resolve()
  await cancelled
  assert.equal(result, reason)
  assert.equal(owner.streaming, false)
  assert.equal(owner.cancelPlayback, undefined)
  assert.deepEqual(order, ['streamer', 'audio', 'completed'])
})

test('a release failure is reported and prevents this provider from reacquiring resources', async () => {
  const owner = new PlaybackProvider()
  const closed: string[] = []
  let result: unknown
  const session = createPlaybackSession(owner, (error) => {
    result = error
  })
  session.addCleanup(() => {
    closed.push('audio')
  })
  session.addCleanup(() => {
    closed.push('streamer')
    throw new Error('streamer did not stop')
  })
  session.onDone()
  await assert.rejects(session.released, { code: 'IO', message: 'streamer did not stop' })
  assert.deepEqual(closed, ['streamer', 'audio'])
  assert.equal(result, playbackReleaseFailure(owner))
  assert.throws(() => createPlaybackSession(owner), { code: 'IO' })
  assert.throws(() => owner.close(), { code: 'IO' })
})

test('an asynchronous release failure cannot be hidden behind successful playback completion', async () => {
  const owner = new PlaybackProvider()
  const session = createPlaybackSession(owner)
  session.addCleanup(async () => {
    throw new Error('input still connected')
  })
  session.onDone()
  await assert.rejects(session.released, { code: 'IO', message: 'input still connected' })
  assert.throws(() => createPlaybackSession(owner), { code: 'IO' })
})

test('provider close is permanent and shares the in-progress release', async () => {
  const owner = new PlaybackProvider()
  const release = deferred()
  let result: { code?: string } | undefined
  const session = createPlaybackSession(owner, (error) => {
    result = error as typeof result
  })
  session.addCleanup(() => release.promise)
  const first = owner.close(),
    second = owner.close()
  assert.equal(first, second)
  assert.equal(session.closed, true)
  release.resolve()
  await first
  assert.equal(result?.code, 'CLOSED')
  assert.throws(() => createPlaybackSession(owner), { code: 'CLOSED' })
  assert.equal(owner.close(), undefined)
})

test('reentrant provider close does not await its own completion', async () => {
  const owner = new PlaybackProvider()
  const session = createPlaybackSession(owner)
  session.addCleanup(() => owner.close())
  await owner.close()
  assert.equal(owner.streaming, false)
})

test('preparation continuations remain owned until they finish after cancellation', async () => {
  const owner = new PlaybackProvider()
  const preparation = deferred()
  const session = createPlaybackSession(owner)
  session.waitFor(preparation.promise)
  let released = false
  const stopping = session.cancel().then(() => {
    released = true
  })
  await drain()
  assert.equal(released, false)
  assert.equal(owner.streaming, true)
  preparation.resolve()
  await stopping
  assert.equal(owner.streaming, false)
})

test('presentation errors settle playback after cleanup without faulting released hardware', async () => {
  for (const phase of ['onPlayed', 'onDone']) {
    const owner = new PlaybackProvider({
      [phase]: () => {
        throw new Error('view closed')
      },
    })
    let result: unknown
    let closes = 0
    const session = createPlaybackSession(owner, (error) => {
      result = error
    })
    session.addCleanup(() => {
      closes++
    })
    session.onPower(10)
    session.onDone()
    await session.released
    assert.equal((result as Error).message, 'view closed')
    assert.equal(closes, 1)
    assert.equal(playbackReleaseFailure(owner), undefined)
  }
})

test('retired sessions suppress their events and immediately release a late resource', async () => {
  let powers = 0,
    callbacks = 0
  const owner = new PlaybackProvider({
    onPlayed: () => {
      powers++
    },
  })
  const first = createPlaybackSession(owner, () => {
    callbacks++
  })
  first.onDone()
  await first.released
  const next = createPlaybackSession(owner, () => {
    callbacks++
  })
  first.onPower(2)
  first.onDone()
  first.fail(new Error('old callback'))
  let lateCloses = 0
  first.addCleanup(() => {
    lateCloses++
  })
  assert.equal(lateCloses, 1)
  assert.equal(next.closed, false)
  assert.equal(powers, 0)
  assert.equal(callbacks, 1)
  await next.cancel()
  assert.equal(callbacks, 2)
})

test('an owned continuation does not block the cleanup needed to settle it', async () => {
  const session = createPlaybackSession(new PlaybackProvider())
  const rendering = deferred()
  let cancelled = false
  session.addCleanup(() => {
    cancelled = true
    rendering.resolve()
  })
  session.waitFor(rendering.promise)
  await session.cancel()
  assert.equal(cancelled, true)
})

test('failures and cancellation without an Error never become successful completion', async () => {
  for (const reason of [undefined, null, false, '']) {
    let error: unknown
    const failed = createPlaybackSession(new PlaybackProvider(), (result) => {
      error = result
    })
    failed.fail(reason)
    await failed.released
    assert.equal((error as { code: string }).code, 'IO')
    const cancelled = createPlaybackSession(new PlaybackProvider(), (result) => {
      error = result
    })
    await cancelled.cancel(reason)
    assert.equal((error as { code: string }).code, 'CANCELLED')
  }
})
