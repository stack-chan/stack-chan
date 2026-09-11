import { CancellationSource } from 'cancellation'
import type { OperationClock } from 'operation-queue'
import { ResourceScope } from 'owned-resources'
import { asStackchanError, finiteNumber, StackchanError } from 'stackchan/errors'
import type { CancellationSignal, TaskContext } from 'stackchan/task'

/** Tracks cooperative tasks without waiting indefinitely for arbitrary app promises. */
export class TaskScope {
  readonly #resources = new ResourceScope()
  readonly #clock: OperationClock
  readonly #capacity: number

  constructor(clock: OperationClock, capacity = 64) {
    finiteNumber(capacity, 'task capacity', 1, 256)
    if (!Number.isInteger(capacity)) throw new StackchanError('INVALID_ARGUMENT', 'Task capacity must be an integer')
    this.#clock = clock
    this.#capacity = capacity
  }

  get size(): number {
    return this.#resources.size
  }
  get closed(): boolean {
    return this.#resources.closed
  }

  run<T>(handler: (task: TaskContext) => T | Promise<T>, parent?: CancellationSignal): Promise<T> {
    if (this.closed) return Promise.reject(new StackchanError('CLOSED', 'App tasks are closed'))
    if (parent?.reason) return Promise.reject(parent.reason)
    if (this.size >= this.#capacity) return Promise.reject(new StackchanError('BUSY', 'Too many app tasks'))
    const source = new CancellationSource()
    const release = this.#resources.defer(() => source.cancel(new StackchanError('CLOSED', 'App closed')))
    return new Promise<T>((resolve, reject) => {
      let settled = false
      let unsubscribeParent: (() => void) | undefined
      let unsubscribe: (() => void) | undefined
      const finish = (result: { value: T } | { error: unknown }) => {
        if (settled) return
        settled = true
        release()
        unsubscribeParent?.()
        unsubscribe?.()
        try {
          source.cancel()
        } catch (error) {
          reject(asStackchanError(error))
          return
        }
        if ('error' in result) reject(asStackchanError(result.error))
        else resolve(result.value)
      }
      unsubscribe = source.signal.subscribe((error) => finish({ error }))
      unsubscribeParent = parent?.subscribe((reason) => source.cancel(reason))
      if (settled) {
        unsubscribeParent?.()
        return
      }
      const task: TaskContext = {
        signal: source.signal,
        sleep: (durationMs) => this.sleep(durationMs, source.signal),
      }
      // Starting through a microtask bounds XS stack use when an input handler
      // calls another SDK operation, which in turn starts a native provider.
      void Promise.resolve()
        .then(() => {
          if (this.closed) throw new StackchanError('CLOSED', 'App tasks are closed')
          source.signal.throwIfCancelled()
          return handler(task)
        })
        .then(
          (value) => finish({ value }),
          (error) => finish({ error }),
        )
    })
  }

  sleep(durationMs: number, signal?: CancellationSignal): Promise<void> {
    finiteNumber(durationMs, 'durationMs', 0, 86_400_000)
    return this.run(
      ({ signal: ownSignal }) =>
        new Promise<void>((resolve, reject) => {
          let cancelTimer: (() => void) | undefined
          const unsubscribe = ownSignal.subscribe((error) => {
            cancelTimer?.()
            reject(error)
          })
          try {
            cancelTimer = this.#clock.after(durationMs, () => {
              unsubscribe()
              resolve()
            })
          } catch (error) {
            unsubscribe()
            reject(error)
          }
        }),
      signal,
    )
  }

  close(): Promise<void> {
    return this.#resources.close()
  }
}
