import Headers from 'headers'
import { URL, URLSearchParams } from 'url'

class Request {
  raw

  constructor(request) {
    this.raw = request
  }
  get method() {
    return this.raw.method.toLowerCase()
  }
  get path() {
    return this.raw.url.pathname
  }
  get url() {
    return this.raw.url.href
  }
  header(key) {
    return this.raw.headers.get(key.toLowerCase())
  }
  query(key) {
    return key ? this.raw.url.searchParams.get(key) : Object.fromEntries(this.raw.url.searchParams.entries())
  }
  async text() {
    return await this.raw.text()
  }
  async json() {
    return await this.raw.json()
  }
  async formData() {
    const queryString = await this.text()
    return Object.fromEntries(new URLSearchParams(queryString))
  }
}

class Response {
  #body
  #headers
  #status = 200
  constructor(body, options = {}) {
    this.#body = body instanceof ArrayBuffer ? body : ArrayBuffer.fromString(body.toString())
    const headers = new Headers()
    if (options.headers) {
      for (const [key, value] of options.headers.entries
        ? options.headers.entries()
        : Object.entries(options.headers)) {
        headers.set(key, value)
      }
    }

    if (headers.get('content-length') === undefined) {
      headers.set('content-length', this.#body.byteLength)
    }
    this.#headers = headers

    this.#status = options.status ?? 200
  }
  get body() {
    return this.#body
  }
  get headers() {
    return this.#headers
  }
  get status() {
    return this.#status
  }
  async arrayBuffer() {
    let body = this.#body
    if (body) {
      this.#body = undefined
      body = await body
    }
    return body
  }
  async json() {
    let body = this.#body
    if (body) {
      this.#body = undefined
      body = await body
      body = String.fromArrayBuffer(body)
      return JSON.parse(body)
    }
    return body
  }
  async text() {
    let body = this.#body
    if (body) {
      this.#body = undefined
      body = await body
      body = String.fromArrayBuffer(body)
    }
    return body
  }
}

class Context {
  #req
  #status
  #headers = new Headers()

  constructor(request) {
    this.#req = new Request(request)
  }
  get req() {
    return this.#req
  }
  status(status) {
    this.#status = status
  }
  header(key, value) {
    this.#headers.set(key, value)
  }
  text(text, status) {
    this.#headers.set('Content-type', 'text/plain')
    return new Response(text, {
      status: status ?? this.#status,
      headers: Object.fromEntries(this.#headers.entries()),
    })
  }
  json(json, status) {
    this.#headers.set('Content-type', 'application/json')
    return new Response(JSON.stringify(json), {
      status: status ?? this.#status,
      headers: Object.fromEntries(this.#headers.entries()),
    })
  }
}

class HttpServerService {
  #routes = {
    get: new Map(),
    post: new Map(),
    put: new Map(),
    patch: new Map(),
    delete: new Map(),
  }
  get = (path, handler) => this.#routes.get.set(path, handler)
  post = (path, handler) => this.#routes.post.set(path, handler)
  put = (path, handler) => this.#routes.put.set(path, handler)
  patch = (path, handler) => this.#routes.patch.set(path, handler)
  delete = (path, handler) => this.#routes.delete.set(path, handler)

  #server
  #closed = false
  #notFound

  constructor(options = {}) {
    this.#notFound = options.onNotFound
    const service = this
    this.#server = new device.network.http.server.io({
      ...device.network.http.server,
      port: options.port ?? 8080,
      onConnect(connection) {
        let current
        connection.accept({
          onRequest(request) {
            current = { request, chunks: [], length: 0, body: undefined, offset: 0 }
          },
          onReadable(count) {
            const chunk = this.read(count)
            current.chunks.push(chunk)
            current.length += chunk.byteLength
          },
          onResponse(response) {
            const state = current
            service.#respond(this, state, response, () => !service.#closed && current === state)
          },
          onWritable(count) {
            const state = current
            if (!state?.body) return
            const length = Math.min(count, state.body.byteLength - state.offset)
            if (length <= 0) return
            const chunk = new DataView(state.body, state.offset, length)
            state.offset += length
            this.write(chunk)
          },
          onDone() {
            current = undefined
          },
          onError() {
            current = undefined
          },
        })
      },
    })
  }

  get port() {
    return this.#server.port
  }

  close() {
    this.#closed = true
    this.#server.close()
  }

  async #respond(connection, state, rawResponse, isCurrent) {
    try {
      const bytes = new Uint8Array(state.length)
      let offset = 0
      for (const chunk of state.chunks) {
        bytes.set(new Uint8Array(chunk), offset)
        offset += chunk.byteLength
      }
      state.chunks = undefined
      let body = bytes.buffer
      const request = state.request
      const query = request.query ? `?${request.query}` : ''
      const rawRequest = {
        method: request.method,
        headers: request.headers,
        url: new URL(`${request.path}${query}`, `http://localhost:${this.#server.port}`),
        async text() {
          const value = body
          body = undefined
          return value === undefined ? undefined : String.fromArrayBuffer(value)
        },
        async json() {
          return JSON.parse(await this.text())
        },
      }
      const context = new Context(rawRequest)
      let response
      try {
        const handler = this.#routes[context.req.method]?.get(context.req.path)
        response = handler
          ? await handler(context)
          : this.#notFound
            ? await this.#notFound(context)
            : context.text('Resource Not Found', 404)
      } catch {
        response = context.text('Internal Server Error', 500)
      }
      state.body = await response.arrayBuffer()
      if (!isCurrent()) return
      rawResponse.status = response.status
      rawResponse.headers = response.headers
      connection.respond(rawResponse)
    } catch {
      if (isCurrent()) connection.close()
    }
  }
}

export { HttpServerService, Response }
