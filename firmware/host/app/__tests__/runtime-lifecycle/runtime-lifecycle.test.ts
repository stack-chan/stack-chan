import { OperationQueue } from 'operation-queue'
import { ResourceScope } from 'owned-resources'
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
  trace('ok\n')
}

run().catch((error) => {
  trace(`runtime lifecycle failed: ${error}\n`)
  throw error
})
