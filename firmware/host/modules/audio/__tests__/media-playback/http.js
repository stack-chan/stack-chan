export const clients = []
export default class Client {
  constructor(options) {
    this.options = options
    clients.push(this)
    if (options.dns)
      new options.dns.io(options.dns).resolve({
        host: options.host,
        onResolved: () => {
          this.resolved = true
        },
        onError: options.onError,
      })
  }
  request(options) {
    this.callbacks = options
    this.offset = 0
    return {
      read: (target) => {
        target.set(this.body.subarray(this.offset, this.offset + target.length))
        this.offset += target.length
      },
    }
  }
  headers(status = 200, values = {}) {
    this.callbacks.onHeaders(status, new Map(Object.entries(values)))
  }
  data(body) {
    this.body = body
    this.offset = 0
    this.callbacks.onReadable(body.length)
  }
  done(error) {
    this.callbacks.onDone(error)
  }
  close() {
    this.closed = true
  }
}
