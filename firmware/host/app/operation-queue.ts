import { asStackchanError, finiteNumber, StackchanError } from 'stackchan/errors'
import type { CancellationSignal } from 'stackchan/task'

export type OperationClock = {
  /** Schedule once and return an idempotent cancellation function. */
  after(milliseconds: number, callback: () => void): () => void
}

type Entry = {
  start(): void
  cancel(reason: StackchanError): void
}

export type OperationQueueOptions = {
  clock: OperationClock
  capacity?: number
  waitTimeoutMs?: number
  operationTimeoutMs?: number
}

/** Bounded FIFO for one physical resource. Cancellation settles even a stalled provider. */
export class OperationQueue {
  #active: Entry | undefined
  #pending: Entry[] = []
  #closed = false
  readonly #options: Required<OperationQueueOptions>

  constructor(options: OperationQueueOptions) {
    this.#options = {
      capacity: 8,
      waitTimeoutMs: 30_000,
      operationTimeoutMs: 120_000,
      ...options,
    }
    finiteNumber(this.#options.capacity, 'capacity', 0, 64)
    if (!Number.isInteger(this.#options.capacity))
      throw new StackchanError('INVALID_ARGUMENT', 'capacity must be an integer')
    finiteNumber(this.#options.waitTimeoutMs, 'waitTimeoutMs', 1)
    finiteNumber(this.#options.operationTimeoutMs, 'operationTimeoutMs', 1)
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

  run<T>(
    start: () => T | Promise<T>,
    cancel?: (reason: StackchanError) => void,
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
      let clearTimer: (() => void) | undefined
      let unsubscribe: (() => void) | undefined
      const finish = (result: { value: T } | { error: StackchanError }) => {
        if (settled) return
        settled = true
        clearTimer?.()
        unsubscribe?.()
        if (this.#active === entry) this.#active = undefined
        const index = this.#pending.indexOf(entry)
        if (index >= 0) this.#pending.splice(index, 1)
        if ('error' in result) reject(result.error)
        else resolve(result.value)
        this.#pump()
      }
      const entry: Entry = {
        start: () => {
          if (settled) return
          active = true
          try {
            clearTimer?.()
            clearTimer = this.#options.clock.after(this.#options.operationTimeoutMs, () => {
              entry.cancel(new StackchanError('TIMEOUT', 'Operation did not finish before its deadline'))
            })
            Promise.resolve(start()).then(
              (value) => finish({ value }),
              (error) => finish({ error: asStackchanError(error) }),
            )
          } catch (error) {
            finish({ error: asStackchanError(error) })
          }
        },
        cancel: (reason) => {
          if (settled) return
          try {
            if (active) cancel?.(reason)
          } catch (error) {
            // A device that failed to release cannot safely serve the next job.
            this.#closed = true
            for (const waiting of [...this.#pending]) waiting.cancel(asStackchanError(error))
          } finally {
            finish({ error: reason })
          }
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

  close(): void {
    if (this.#closed) return
    this.#closed = true
    const reason = new StackchanError('CLOSED', 'Resource owner closed')
    for (const entry of [...this.#pending]) entry.cancel(reason)
    this.#active?.cancel(reason)
  }

  #pump(): void {
    if (this.#closed || this.#active) return
    this.#active = this.#pending.shift()
    this.#active?.start()
  }
}
