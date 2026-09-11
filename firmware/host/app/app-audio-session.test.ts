import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { writeAliasPackage, writeAliasPackageSubpath } from '../modules/testing/node-alias-package.js'
import type { AppAudioPort } from './app-audio-session.js'

async function setup() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  writeAliasPackage(root, 'cancellation', resolve(root, 'app/cancellation.js'))
  writeAliasPackageSubpath(root, 'stackchan', 'errors', resolve(root, '../sdk/errors.js'))
  const { AppAudioSession } = await import('./app-audio-session.js')
  const { CancellationSource } = await import('./cancellation.js')
  const { StackchanError } = await import('../../sdk/errors.js')
  return { AppAudioSession, CancellationSource, StackchanError }
}
const drain = () => new Promise<void>((resolve) => setImmediate(resolve))
const port = (): AppAudioPort => ({
  async say() {},
  async playClip() {},
  async tone() {},
  async play() {},
  async record() {
    throw new Error('recording is not configured in this test')
  },
  releaseFailure: undefined,
})

test('recording returns its data and closing owns both input and output until their releases finish', async () => {
  const { AppAudioSession } = await setup()
  const backend = port()
  const audio = new AppAudioSession(backend)
  const recorded = {
    data: new ArrayBuffer(4),
    mimeType: 'audio/webm',
    filename: 'recording.webm',
  }
  backend.record = async () => recorded
  assert.equal(await audio.record({ durationMs: 10 }), recorded)
  const releases: Array<() => void> = []
  backend.record = (options) =>
    new Promise((_, reject) => {
      options?.signal?.subscribe((reason) => releases.push(() => reject(reason)))
    })
  backend.play = (_data, options) =>
    new Promise((_, reject) => {
      options?.signal?.subscribe((reason) => releases.push(() => reject(reason)))
    })
  const input = assert.rejects(audio.record(), { code: 'CLOSED' })
  const output = assert.rejects(audio.play(recorded), { code: 'CLOSED' })
  await drain()
  let closed = false
  const closing = audio.close().then(() => {
    closed = true
  })
  await drain()
  assert.equal(releases.length, 2, 'both operations are cancelled before either is awaited')
  assert.equal(closed, false)
  releases[0]()
  await input
  assert.equal(closed, false)
  releases[1]()
  await output
  await closing
  assert.equal(audio.pendingCount, 0)
  await assert.rejects(audio.record(), { code: 'CLOSED' })
})

test('100 successful and cancelled commands return app audio registrations to baseline', async () => {
  const { AppAudioSession, CancellationSource } = await setup()
  const backend = port()
  const audio = new AppAudioSession(backend)
  for (let cycle = 0; cycle < 100; cycle++) {
    const parent = new CancellationSource()
    await audio.say('hello', { signal: parent.signal })
    assert.equal(parent.size, 0)
    assert.equal(audio.pendingCount, 0)
    let release!: () => void
    backend.tone = (_hz, options) =>
      new Promise((_, reject) => {
        options.signal?.subscribe((reason) => {
          release = () => reject(reason)
        })
      })
    const pending = assert.rejects(audio.tone(440, { durationMs: 10, signal: parent.signal }), { code: 'CANCELLED' })
    await drain()
    parent.cancel()
    assert.equal(audio.pendingCount, 1, 'cancellation retains the operation until physical release')
    release()
    await pending
    assert.equal(parent.size, 0)
    assert.equal(audio.pendingCount, 0)
  }
  await audio.close()
})

test('app close cancels every operation before awaiting release and remains closed to late calls', async () => {
  const { AppAudioSession } = await setup()
  const backend = port()
  const releases: Array<() => void> = []
  const cancelled: string[] = []
  backend.say = (text, options) =>
    new Promise((_, reject) => {
      options?.signal?.subscribe((reason) => {
        cancelled.push(text)
        releases.push(() => reject(reason))
      })
    })
  const audio = new AppAudioSession(backend)
  const first = assert.rejects(audio.say('first'), { code: 'CLOSED' })
  const second = assert.rejects(audio.say('second'), { code: 'CLOSED' })
  await drain()
  let closed = false
  const closing = audio.close()
  assert.equal(closing, audio.close())
  const done = closing.then(() => {
    closed = true
  })
  await drain()
  assert.deepEqual(cancelled, ['first', 'second'])
  assert.equal(closed, false)
  await assert.rejects(audio.playClip('late'), { code: 'CLOSED' })
  releases[0]()
  await first
  assert.equal(closed, false)
  releases[1]()
  await second
  await done
  assert.equal(audio.pendingCount, 0)
})

test('closing before acquisition and using a cancelled signal never starts the backend', async () => {
  const { AppAudioSession, CancellationSource } = await setup()
  const backend = port()
  let starts = 0
  backend.say = async () => {
    starts++
  }
  const audio = new AppAudioSession(backend)
  const parent = new CancellationSource()
  parent.cancel()
  await assert.rejects(audio.say('cancelled', { signal: parent.signal }), { code: 'CANCELLED' })
  const started = assert.rejects(audio.say('closed before acquisition'), { code: 'CLOSED' })
  await audio.close()
  await started
  assert.equal(starts, 0)
  assert.equal(parent.size, 0)
})

test('normal operation errors allow later work but physical release failure reaches close', async () => {
  const { AppAudioSession, StackchanError } = await setup()
  const backend = port()
  backend.say = async () => {
    throw undefined
  }
  const audio = new AppAudioSession(backend)
  await assert.rejects(audio.say('failed'), { code: 'IO' })
  await audio.playClip('next')
  const failure = new StackchanError('IO', 'Output was not released')
  Object.defineProperty(backend, 'releaseFailure', { get: () => failure })
  await assert.rejects(audio.tone(440, { durationMs: 10 }), (error) => error === failure)
  await assert.rejects(audio.close(), (error) => error === failure)
  assert.equal(audio.pendingCount, 0)
})

test('a broken subscription cleanup is retained while all other cancellation handlers still run', async () => {
  const { AppAudioSession } = await setup()
  const backend = port()
  const audio = new AppAudioSession(backend)
  let cleaned = 0
  backend.say = async (_text, options) => {
    options?.signal?.subscribe(() => {
      cleaned++
    })
  }
  await assert.rejects(
    audio.say('hello', {
      signal: {
        reason: undefined,
        throwIfCancelled() {},
        subscribe() {
          return () => {
            throw new Error('unsubscribe failed')
          }
        },
      },
    }),
    { code: 'IO', message: 'unsubscribe failed' },
  )
  assert.equal(cleaned, 1)
  assert.equal(audio.pendingCount, 0)
  await assert.rejects(audio.close(), { code: 'IO', message: 'unsubscribe failed' })
})
