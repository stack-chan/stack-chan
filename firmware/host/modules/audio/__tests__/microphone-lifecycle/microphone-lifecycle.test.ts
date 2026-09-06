import AudioIn from 'audio-in'
import { CancellationSource } from 'cancellation'
import Microphone from 'microphone'
import { assert, equal } from 'testing/assert'
import Timer from 'timer'

class Clock {
  readonly active = new Set<ReturnType<typeof Timer.set>>()
  fail = false
  after(durationMs: number, callback: () => void): () => void {
    if (this.fail) throw new Error('timer setup failed')
    const timer = Timer.set(() => {
      this.active.delete(timer)
      callback()
    }, durationMs)
    this.active.add(timer)
    return () => {
      if (this.active.delete(timer)) Timer.clear(timer)
    }
  }
}
const current = () => AudioIn.instances[AudioIn.instances.length - 1]
const bytes = (...values: number[]) => new Uint8Array(values).buffer
const observe = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error) => error,
  )

async function rejected(promise: Promise<unknown>, code: string) {
  const error = await observe(promise)
  equal(error?.code, code, `recording rejects with ${code}`)
}
function throws(action: () => void, code: string) {
  let error: { code?: string } | undefined
  try {
    action()
  } catch (caught) {
    error = caught as { code?: string }
  }
  equal(error?.code, code, `operation throws ${code}`)
}

async function run() {
  const clock = new Clock()
  const mic = new Microphone({ clock })
  const beforeInvalid = AudioIn.instances.length
  for (const invalid of [0, -1, NaN, Infinity, 15_001]) await rejected(mic.record(invalid), 'INVALID_ARGUMENT')
  equal(AudioIn.instances.length, beforeInvalid, 'invalid durations acquire no input')

  for (let cycle = 0; cycle < 100; cycle++) {
    const source = new CancellationSource()
    const recording = mic.record(5, { signal: source.signal })
    const native = current()
    equal(native.channels, 1, 'recording opens mono input')
    native.chunks = [bytes(1, 2), bytes(3, 4, 5, 6, 7, 8, 9, 10)]
    native.readable(10)
    equal(mic.recording, true, 'a short read advances by bytes actually received')
    native.readable(8)
    equal(native.closes, 0, 'input release waits until the readable callback returns')
    const result = new Uint8Array(await recording, 44)
    equal(result.byteLength, 10, 'all requested frames returned')
    equal(result[9], 10, 'short reads do not insert zero padding')
    equal(native.closes, 1, 'success releases the input once')
    equal(source.size, 0, 'success removes cancellation registration')
    equal(clock.active.size, 0, 'success clears deadline')

    const next = new CancellationSource()
    const cancelled = observe(mic.record(5, { signal: next.signal }))
    const nextNative = current()
    native.readable(10)
    equal(native.reads, 2, 'late callback cannot read the released input')
    equal(nextNative.reads, 0, 'late callback cannot read a newer input')
    next.cancel()
    equal((await cancelled)?.code, 'CANCELLED', 'cancellation settles recording')
    equal(nextNative.closes, 1, 'cancellation closes once')
    equal(next.size, 0, 'cancel leaves no registration')
    equal(clock.active.size, 0, 'cancel leaves no timer')
  }

  for (const chunk of [undefined, bytes(), bytes(1), bytes(1, 2, 3, 4)]) {
    const pending = observe(mic.record(1))
    current().chunks = [chunk]
    current().readable(2)
    equal((await pending)?.code, 'IO', 'empty, partial-frame or oversized reads fail')
    equal(current().closes, 1, 'invalid reads close the input')
  }

  AudioIn.failConstructor = true
  await rejected(mic.record(1), 'IO')
  equal(mic.recording, false, 'constructor failure rolls back state')
  AudioIn.failConstructor = false
  AudioIn.failStart = true
  await rejected(mic.record(1), 'IO')
  equal(current().closes, 1, 'record start failure closes the acquired input')
  throws(() => mic.start(), 'IO')
  equal(current().closes, 1, 'stream start failure also closes the input')
  AudioIn.failStart = false

  AudioIn.format.sampleRate = 192_000
  await rejected(mic.record(15_000), 'INVALID_ARGUMENT')
  equal(current().closes, 1, 'buffer budget rejection releases the input')
  AudioIn.format.sampleRate = 1000
  clock.fail = true
  await rejected(mic.record(1), 'IO')
  equal(current().closes, 1, 'deadline setup failure releases the input')
  clock.fail = false

  const timedOut = mic.record(1)
  await rejected(timedOut, 'TIMEOUT')
  equal(current().closes, 1, 'missing callbacks eventually release the input')
  equal(clock.active.size, 0, 'timeout leaves no timer')

  const pending = observe(mic.record(10))
  await rejected(mic.record(1), 'BUSY')
  mic.close()
  equal((await pending)?.code, 'CLOSED', 'close settles pending recording')
  mic.close()
  equal(current().closes, 1, 'close is idempotent')
  await rejected(mic.record(1), 'CLOSED')
  throws(() => mic.start(), 'CLOSED')

  const streaming = new Microphone()
  let callbacks = 0
  streaming.onReadable = () => {
    callbacks++
  }
  streaming.start()
  const oldStream = current()
  streaming.stop()
  streaming.start()
  const newStream = current()
  oldStream.readable(2)
  newStream.readable(2)
  equal(callbacks, 1, 'stopped streaming callbacks are suppressed')
  newStream.onClose = () => {
    throws(() => streaming.start(), 'BUSY')
  }
  streaming.stop()
  streaming.close()

  const reentrant = new Microphone()
  reentrant.start()
  const obsolete = current()
  let stopping: Promise<void> | undefined
  reentrant.onReadable = () => {
    stopping = Promise.resolve(reentrant.stop())
    throws(() => reentrant.start(), 'BUSY')
  }
  obsolete.readable(2)
  equal(obsolete.closes, 0, 'stream stop also waits until callback returns')
  await stopping
  reentrant.start()
  obsolete.readable(2)
  equal(current().closes, 0, 'an obsolete callback cannot stop a replacement stream')
  reentrant.close()

  const badListener = new Microphone()
  badListener.start()
  badListener.onReadable = () => {
    throw new Error('listener failed')
  }
  throws(() => current().readable(2), 'IO')
  await badListener.stop()
  equal(current().closes, 1, 'throwing stream listener still releases input after returning')
  badListener.close()

  const faulted = new Microphone({ clock })
  const failure = observe(faulted.record(1))
  const broken = current()
  broken.closeFailure = true
  broken.chunks = [bytes(1, 2)]
  broken.readable(2)
  equal((await failure)?.code, 'IO', 'close failure cannot report successful recording')
  equal(clock.active.size, 0, 'close failure still clears deadline')
  const attempts = AudioIn.instances.length
  await rejected(faulted.record(1), 'IO')
  throws(() => faulted.start(), 'IO')
  throws(() => faulted.close(), 'IO')
  equal(AudioIn.instances.length, attempts, 'failed physical release prevents reacquisition')
  equal(broken.closes, 1, 'failed input close is not repeated')
  assert(
    AudioIn.instances.every((input) => input.closes === 1),
    'all acquired inputs received one close',
  )
  assert(
    AudioIn.instances.every((input) => input.closesInCallback === 0),
    'no input closes during callback delivery',
  )
  trace('ok\n')
}
Promise.resolve()
  .then(run)
  .catch((error) => trace(`FAIL ${error.message}: ${error.stack}\n`))
