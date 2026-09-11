import HTTPClient from 'embedded:network/http/client'

type ResolverRequest = { host: string; onResolved(host: string, address: string): void; onError(error: unknown): void }
export class Resolver {
  static instances: Resolver[] = []
  static resolveFailure = false
  closes = 0
  #request?: ResolverRequest
  constructor(_options: object) {
    Resolver.instances.push(this)
  }
  resolve(request: ResolverRequest) {
    this.#request = request
    if (Resolver.resolveFailure) throw new Error('resolve failed')
  }
  succeed() {
    this.#request?.onResolved(this.#request.host, '127.0.0.1')
  }
  fail() {
    this.#request?.onError(new Error('DNS failed'))
  }
  close() {
    this.closes++
  }
}

type SocketOptions = { onReadable(count: number): void; onWritable(count: number): void; onError(): void }
export class Socket {
  static instances: Socket[] = []
  static constructorFailure = false
  format = 'buffer'
  written = ''
  closes = 0
  closeFailure = false
  closesInCallback = 0
  #inCallback = false
  #received = new Uint8Array(0)
  #offset = 0
  constructor(readonly options: SocketOptions) {
    if (Socket.constructorFailure) throw new Error('socket constructor failed')
    Socket.instances.push(this)
  }
  connect() {
    this.options.onWritable(65536)
  }
  write(buffer: ArrayBuffer | Uint8Array) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
    this.written += String.fromArrayBuffer(bytes.slice().buffer)
    return 65536
  }
  read(count?: number) {
    if (this.format === 'number') return this.#received[this.#offset++]
    const result = this.#received.slice(this.#offset, this.#offset + (count ?? this.#received.length))
    this.#offset += result.byteLength
    return result.buffer
  }
  receive(text: string) {
    this.#received = new Uint8Array(ArrayBuffer.fromString(text))
    this.#offset = 0
    this.#inCallback = true
    try {
      this.options.onReadable(this.#received.byteLength)
    } finally {
      this.#inCallback = false
    }
  }
  respond(body: string, status = 200) {
    this.receive(
      `HTTP/1.1 ${status} Response\r\nContent-Length: ${ArrayBuffer.fromString(body).byteLength}\r\n\r\n${body}`,
    )
  }
  close() {
    this.closes++
    if (this.#inCallback) this.closesInCallback++
    if (this.closeFailure) throw new Error('socket close failed')
  }
}

export const http = { io: HTTPClient, dns: { io: Resolver }, socket: { io: Socket } }
export const lastResolver = () => Resolver.instances[Resolver.instances.length - 1]
export const lastSocket = () => Socket.instances[Socket.instances.length - 1]
export function connect() {
  lastResolver().succeed()
  const socket = lastSocket()
  socket.connect()
  return socket
}
