import assert from 'node:assert/strict'
import test from 'node:test'
import { serializeReadableBursts } from '../safe-readable-socket.js'
test('readable burst stops when its first callback closes the socket', () => {
  class Socket {
    reads = 0
    constructor(readonly options: { onReadable(count: number): void }) {}
    close() {}
    trigger(count: number) {
      this.options.onReadable.call(this, count)
    }
  }
  const SafeSocket = serializeReadableBursts(Socket)
  const socket = new SafeSocket({
    onReadable(this: Socket, count: number) {
      while (count--) {
        this.reads += 1
        this.close()
      }
    },
  })
  socket.trigger(2)
  assert.equal(socket.reads, 1)
})
