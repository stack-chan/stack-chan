import  listen  from 'listen'
import Headers from 'headers'
import { URLSearchParams } from 'url'

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
  constructor(body, options) {
    if (!(body instanceof ArrayBuffer)) {
      body = body.toString()
      body = ArrayBuffer.fromString(body)
    }
    this.#body = body
    const headers = new Headers()
    if (options.headers) {
      Object.entries(options.headers).forEach(([key, value]) => headers.set(key, value))
    }

    if (headers.get('content-length') == undefined) {
      headers.set('content-length', body.byteLength)
    }
    this.#headers = headers

    this.#status = options && options.status ? options.status : 200
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
  get = (path, handler) => this.#routes['get'].set(path, handler)
  post = (path, handler) => this.#routes['post'].set(path, handler)
  put = (path, handler) => this.#routes['put'].set(path, handler)
  patch = (path, handler) => this.#routes['patch'].set(path, handler)
  delete = (path, handler) => this.#routes['delete'].set(path, handler)

  constructor(options = {}) {
    const port = options?.port
    this.#listen(port)
  }

  async #listen(port) {
    for await (const connection of listen({ port })) {
      const context = new Context(connection.request)
      const req = context.req
      let response

      try {
        const handler = this.#routes[req.method].get(req.path)
        if (!handler) {
          response = context.text('Resource Not Found', 404)
        } else {
          response = await handler(context)
        }
      } catch (e) {
        response = context.text('Internal Server Error', 500)
      } finally {
        connection.respondWith(response)
      }
    }
  }
}

export { HttpServerService, Response }
