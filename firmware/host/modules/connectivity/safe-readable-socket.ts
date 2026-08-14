export function serializeReadableBursts(Socket) {
  return class extends Socket {
    #closed = false
    constructor(options) {
      const onReadable = options.onReadable
      super({
        ...options,
        onReadable: (count) => {
          while (count-- && !this.#closed) onReadable.call(this, 1)
        },
      })
    }
    close() {
      this.#closed = true
      super.close()
    }
  }
}
