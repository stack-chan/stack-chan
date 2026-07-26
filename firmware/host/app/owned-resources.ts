export type CloseHandler = () => void | Promise<void>

export class OwnedResources {
  #handlers: CloseHandler[]
  #closed = false

  constructor(handlers: ReadonlyArray<CloseHandler> = []) {
    this.#handlers = [...handlers]
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    let firstError: unknown
    let hasError = false
    for (const handler of this.#handlers) {
      try {
        await handler()
      } catch (error) {
        if (!hasError) {
          firstError = error
          hasError = true
        }
      }
    }
    this.#handlers.length = 0
    if (hasError) throw firstError
  }
}
