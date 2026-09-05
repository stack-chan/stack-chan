export type CloseHandler = () => void | Promise<void>

/** Owns resources in acquisition order and releases them in reverse order. */
export class ResourceScope {
  #handlers: CloseHandler[] = []
  #closePromise: Promise<void> | undefined

  constructor(handlers: ReadonlyArray<CloseHandler> = []) {
    this.#handlers = [...handlers]
  }

  get closed(): boolean {
    return this.#closePromise !== undefined
  }

  get size(): number {
    return this.#handlers.length
  }

  /** Register immediately after acquisition. The return value relinquishes ownership. */
  defer(handler: CloseHandler): () => void {
    if (this.closed) throw new Error('Resource scope is closed')
    const registration = () => handler()
    this.#handlers.push(registration)
    return () => {
      const index = this.#handlers.indexOf(registration)
      if (index >= 0) this.#handlers.splice(index, 1)
    }
  }

  own<T extends { close(): void | Promise<void> }>(resource: T): T {
    this.defer(() => resource.close())
    return resource
  }

  close(): Promise<void> {
    if (!this.#closePromise) {
      let resolveClose!: () => void
      let rejectClose!: (error: unknown) => void
      // Publish the promise before a user cleanup can call close recursively.
      this.#closePromise = new Promise<void>((resolve, reject) => {
        resolveClose = resolve
        rejectClose = reject
      })
      void this.#closeAll().then(resolveClose, rejectClose)
    }
    return this.#closePromise
  }

  async #closeAll(): Promise<void> {
    let firstError: unknown
    let hasError = false
    while (this.#handlers.length > 0) {
      const handler = this.#handlers.pop()
      try {
        const result = handler?.()
        // A cleanup may return the owner's already-published close promise.
        if (result !== this.#closePromise) await result
      } catch (error) {
        if (!hasError) {
          firstError = error
          hasError = true
        }
      }
    }
    if (hasError) throw firstError
  }
}

/** Existing host close-handler lists declare teardown order, not acquisition order. */
export class OwnedResources extends ResourceScope {
  constructor(handlers: ReadonlyArray<CloseHandler> = []) {
    super([...handlers].reverse())
  }
}
