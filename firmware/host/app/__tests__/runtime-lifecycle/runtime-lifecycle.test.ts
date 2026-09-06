import { AppSession } from 'app-session'
import { CancellationSource } from 'cancellation'
import { OperationQueue } from 'operation-queue'
import { ResourceScope } from 'owned-resources'
import { defineApp } from 'stackchan'
import { StackchanError } from 'stackchan/errors'
import { assert, equal } from 'testing/assert'
import Timer from 'timer'

async function run(): Promise<void> {
  trace('runtime lifecycle: begin\n')
  let timers = 0
  let resources = 0
  const clock = {
    after(milliseconds: number, callback: () => void) {
      let active = true
      timers += 1
      const timer = Timer.set(() => {
        if (!active) return
        active = false
        timers -= 1
        callback()
      }, milliseconds)
      return () => {
        if (!active) return
        active = false
        timers -= 1
        Timer.clear(timer)
      }
    },
  }
  for (let cycle = 0; cycle < 100; cycle += 1) {
    const scope = new ResourceScope()
    resources += 1
    scope.defer(() => {
      resources -= 1
    })
    const queue = scope.own(new OperationQueue({ clock }))
    scope.defer(() => scope.close())
    if (cycle === 0) trace('runtime lifecycle: first operation\n')
    equal(await queue.run(() => 42), 42, 'operation returns its result')
    if (cycle === 0) trace('runtime lifecycle: first close\n')
    let late: (() => void) | undefined
    const pending = queue.run(
      () =>
        new Promise<void>((resolve) => {
          late = resolve
        }),
    )
    let errorCode: string | undefined
    const caught = pending.catch((error) => {
      errorCode = error.code
    })
    const closed = scope.close()
    equal(closed, scope.close(), 'close returns the same promise')
    await closed
    await caught
    if (cycle === 0) trace('runtime lifecycle: first close finished\n')
    late?.()
    equal(errorCode, 'CLOSED', 'closing fails a pending operation')
    equal(resources, 0, 'resources return to baseline')
    equal(timers, 0, 'deadline timers return to baseline')
    const listeners = new Set<() => void>()
    const sessionErrors: unknown[] = []
    const session = new AppSession(
      {
        motion: {
          info: { availability: 'unavailable', reason: 'No test motion device' },
          async move() {
            throw new Error('No test motion device')
          },
          lookAt() {},
          lookAway() {},
          async stop() {},
          async close() {},
        },
        face: { setEmotion() {}, setColor() {}, setMouthOpen() {} },
        audio: { async say() {}, async playClip() {}, async tone() {} },
        input: {
          subscribePress(handler) {
            listeners.add(handler)
            return () => {
              listeners.delete(handler)
            }
          },
        },
        ui: { showBalloon() {}, hideBalloon() {}, showImage() {}, hideImage() {} },
        camera: {
          info: { availability: 'unavailable', reason: 'test', formats: [] },
          async capture() {
            throw new Error('unavailable')
          },
          async close() {},
        },
        capabilities: { get: () => ({ availability: 'simulated' }) },
      },
      clock,
      (error) => sessionErrors.push(error),
    )
    await session.start(
      defineApp({
        setup(app) {
          app.time.every(10_000, () => {})
          app.input.onPress('primary', async (task) => {
            await task.sleep(10_000)
          })
        },
      }),
    )
    for (const listener of listeners) listener()
    const end = session.close()
    equal(end, session.close(), 'app close returns the same promise')
    await end
    equal(listeners.size, 0, 'app input listeners return to baseline')
    equal(timers, 0, 'app timers return to baseline')
    equal(session.resourceCount, 0, 'app resources return to baseline')
    equal(session.taskCount, 0, 'app tasks return to baseline')
    equal(sessionErrors.length, 0, 'cancellation is not reported as a handler failure')
  }
  const queue = new OperationQueue({ clock, operationTimeoutMs: 10 })
  trace('runtime lifecycle: deadline\n')
  let cancelled = 0
  try {
    await queue.run(
      () => new Promise<void>(() => {}),
      () => {
        cancelled += 1
      },
    )
    assert(false, 'a stalled operation must time out')
  } catch (error) {
    equal(error instanceof StackchanError ? error.code : undefined, 'TIMEOUT', 'deadline has a stable error code')
  }
  equal(cancelled, 1, 'timeout cancels the provider once')
  equal(timers, 0, 'timeout releases its timer')
  await queue.close()
  for (let cycle = 0; cycle < 100; cycle += 1) {
    const source = new CancellationSource()
    const serial = new OperationQueue({ clock })
    let stopped = false
    let late: (() => void) | undefined
    const operation = serial.run(
      () =>
        new Promise<void>((resolve) => {
          late = resolve
        }),
      () =>
        new Promise<void>((resolve) => {
          clock.after(1, () => {
            stopped = true
            resolve()
          })
        }),
      source.signal,
    )
    const caught = operation.catch((error) => {
      equal(error.code, 'CANCELLED', 'the cancelled operation retains its reason')
    })
    let starts = 0
    const following = serial.run(() => {
      assert(stopped, 'the next operation starts after physical stop acknowledgement')
      starts += 1
    })
    source.cancel()
    late?.()
    await Promise.resolve()
    equal(starts, 0, 'late completion cannot release the resource while stopping')
    await caught
    await following
    const closing = serial.close()
    equal(closing, serial.close(), 'queue close shares its completion')
    await closing
    equal(starts, 1)
    equal(source.size, 0, 'cancel subscriptions return to baseline')
    equal(timers, 0, 'asynchronous stop timers return to baseline')
  }
  trace('ok\n')
}

run().catch((error) => {
  trace(`runtime lifecycle failed: ${error}\n`)
  throw error
})
