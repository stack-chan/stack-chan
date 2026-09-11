import { StackchanError } from 'stackchan/errors'
import type { CancellationSignal } from 'stackchan/task'

/** Host-owned source; apps only receive the read-only signal. */
export class CancellationSource {
  #reason: StackchanError | undefined
  #listeners = new Set<(reason: StackchanError) => void>()
  readonly signal: CancellationSignal

  constructor() {
    const source = this
    this.signal = Object.freeze({
      get reason() {
        return source.#reason
      },
      throwIfCancelled() {
        if (source.#reason) throw source.#reason
      },
      subscribe(listener: (reason: StackchanError) => void) {
        if (source.#reason) {
          listener(source.#reason)
          return () => {}
        }
        source.#listeners.add(listener)
        return () => {
          source.#listeners.delete(listener)
        }
      },
    })
  }

  get size(): number {
    return this.#listeners.size
  }

  cancel(reason = new StackchanError('CANCELLED', 'Operation cancelled')): void {
    if (this.#reason) return
    this.#reason = reason
    let failed = false
    let failure: unknown
    const listeners = [...this.#listeners]
    this.#listeners.clear()
    for (const listener of listeners) {
      try {
        listener(reason)
      } catch (error) {
        if (!failed) {
          failed = true
          failure = error
        }
      }
    }
    if (failed) throw failure
  }
}
