import { asStackchanError, finiteNumber, StackchanError } from 'stackchan/errors'
import type { CancellationSignal } from 'stackchan/task'

export type OperationClock = {
  /** Schedule once and return an idempotent cancellation function. */
  after(milliseconds: number, callback: () => void): () => void
}

type Entry = {
  start(): void
  cancel(reason: StackchanError): void
  readonly done: Promise<void>
}

export type OperationQueueOptions = {
  clock: OperationClock
  capacity?: number
  waitTimeoutMs?: number
  operationTimeoutMs?: number
  /** Maximum time to wait for an asynchronous physical stop before faulting. */
  cancellationTimeoutMs?: number
}

/** Bounded FIFO. Resource handoff waits for cancellation cleanup, including asynchronous stops. */
export class OperationQueue {
  #active: Entry | undefined
  #pending: Entry[] = []
  #closed = false
  #failure: StackchanError | undefined
  #closePromise: Promise<void> | undefined
  readonly #options: Required<OperationQueueOptions>

  constructor(options: OperationQueueOptions) {
    this.#options = {
      capacity: 8,
      waitTimeoutMs: 30_000,
      operationTimeoutMs: 120_000,
      cancellationTimeoutMs: 5_000,
      ...options,
    }
    finiteNumber(this.#options.capacity, 'capacity', 0, 64)
    if (!Number.isInteger(this.#options.capacity))
      throw new StackchanError('INVALID_ARGUMENT', 'capacity must be an integer')
    finiteNumber(this.#options.waitTimeoutMs, 'waitTimeoutMs', 1)
    finiteNumber(this.#options.operationTimeoutMs, 'operationTimeoutMs', 1)
    finiteNumber(this.#options.cancellationTimeoutMs, 'cancellationTimeoutMs', 1, 60_000)
  }

  get size(): number {
    return this.#pending.length + (this.#active ? 1 : 0)
  }
  get busy(): boolean {
    return this.size > 0
  }
  get closed(): boolean {
    return this.#closed
  }
  get failure(): StackchanError | undefined {
    return this.#failure
  }

  /** A provider confirmed a release failure even though its operation ended. */
  fail(error: unknown): Promise<void> {
    const failure = asStackchanError(error)
    this.#fault(failure)
    return this.close(failure)
  }

  run<T>(
    start: () => T | Promise<T>,
    cancel?: (reason: StackchanError) => void | Promise<void>,
    signal?: CancellationSignal,
  ): Promise<T> {
    if (this.#closed) return Promise.reject(new StackchanError('CLOSED', 'Operation queue is closed'))
    if (signal?.reason) return Promise.reject(signal.reason)
    if (this.#active && this.#pending.length >= this.#options.capacity) {
      return Promise.reject(new StackchanError('BUSY', 'Operation queue is full'))
    }
    return new Promise<T>((resolve, reject) => {
      let settled = false
      let active = false
      let cancelling = false
      let clearTimer: (() => void) | undefined
      let unsubscribe: (() => void) | undefined
      let completeEntry: () => void
      const done = new Promise<void>((resolveDone) => {
        completeEntry = resolveDone
      })
      const clearDeadline = () => {
        const clear = clearTimer
        clearTimer = undefined
        clear?.()
      }
      const finish = (result: { value: T } | { error: StackchanError }) => {
        if (settled) return
        settled = true
        clearDeadline()
        unsubscribe?.()
        if (this.#active === entry) this.#active = undefined
        const index = this.#pending.indexOf(entry)
        if (index >= 0) this.#pending.splice(index, 1)
        if ('error' in result) reject(result.error)
        else resolve(result.value)
        completeEntry()
        this.#pump()
      }
      const entry: Entry = {
        done,
        start: () => {
          if (settled) return
          active = true
          try {
            clearDeadline()
            clearTimer = this.#options.clock.after(this.#options.operationTimeoutMs, () => {
              entry.cancel(new StackchanError('TIMEOUT', 'Operation did not finish before its deadline'))
            })
            Promise.resolve(start()).then(
              (value) => {
                if (!cancelling) finish({ value })
              },
              (error) => {
                if (!cancelling) finish({ error: asStackchanError(error) })
              },
            )
          } catch (error) {
            if (!cancelling) finish({ error: asStackchanError(error) })
          }
        },
        cancel: (reason) => {
          if (settled || cancelling) return
          cancelling = true
          clearDeadline()
          unsubscribe?.()
          unsubscribe = undefined
          try {
            const cleanup = active ? cancel?.(reason) : undefined
            if (cleanup) {
              // Observe both outcomes before scheduling: a clock failure must
              // neither leak a rejection nor make the resource reusable.
              Promise.resolve(cleanup).then(
                () => finish({ error: reason }),
                (error) => {
                  if (settled) return
                  this.#fault(asStackchanError(error))
                  finish({ error: reason })
                },
              )
              clearTimer = this.#options.clock.after(this.#options.cancellationTimeoutMs, () => {
                if (settled) return
                this.#fault(new StackchanError('TIMEOUT', 'Resource stop did not finish before its deadline'))
                finish({ error: reason })
              })
              return
            }
          } catch (error) {
            this.#fault(asStackchanError(error))
          }
          finish({ error: reason })
        },
      }
      unsubscribe = signal?.subscribe((reason) => entry.cancel(reason))
      if (settled) {
        unsubscribe?.()
        return
      }
      if (!this.#active) {
        this.#active = entry
        entry.start()
      } else {
        try {
          clearTimer = this.#options.clock.after(this.#options.waitTimeoutMs, () => {
            entry.cancel(new StackchanError('TIMEOUT', 'Timed out waiting for the resource'))
          })
          this.#pending.push(entry)
        } catch (error) {
          finish({ error: asStackchanError(error) })
        }
      }
    })
  }

  close(reason = new StackchanError('CLOSED', 'Resource owner closed')): Promise<void> {
    if (this.#closePromise) return this.#closePromise
    this.#closed = true
    const entries = [...this.#pending]
    if (this.#active) entries.push(this.#active)
    // Publish before invoking a stop that may reenter close().
    this.#closePromise = Promise.all(entries.map((entry) => entry.done)).then(() => {
      if (this.#failure) throw this.#failure
    })
    for (const entry of entries) entry.cancel(reason)
    return this.#closePromise
  }

  #fault(error: StackchanError): void {
    this.#failure ??= error
    this.#closed = true
    for (const waiting of [...this.#pending]) waiting.cancel(this.#failure)
  }

  #pump(): void {
    if (this.#closed || this.#active) return
    this.#active = this.#pending.shift()
    this.#active?.start()
  }
}
