declare module 'listen' {
  interface ListenOptions {
    port?: number
  }

  interface RequestHeaders {
    get(name: string): string | undefined
    set(name: string, value: string): void
    [Symbol.iterator](): Iterator<[string, string]>
  }

  interface RequestURL {
    href: string
    pathname: string
    searchParams: any // URLSearchParams not available in Moddable
  }

  interface RequestInit {
    method?: string
    headers?: RequestHeaders
    body?: Promise<ArrayBuffer>
  }

  class Request {
    readonly bodyUsed: boolean
    readonly headers: RequestHeaders
    readonly method: string
    readonly url: RequestURL

    constructor(url: RequestURL, options?: RequestInit)

    arrayBuffer(): Promise<ArrayBuffer | undefined>
    json(): Promise<any>
    text(): Promise<string | undefined>
  }

  interface ResponseHeaders {
    get(name: string): string | undefined
    set(name: string, value: string): void
    [Symbol.iterator](): Iterator<[string, string]>
  }

  interface ResponseInit {
    status?: number
    headers?: ResponseHeaders | Record<string, string>
  }

  class Response {
    readonly body: ArrayBuffer
    readonly headers: ResponseHeaders
    readonly status: number

    constructor(body: ArrayBuffer | string, options?: ResponseInit)

    arrayBuffer(): Promise<ArrayBuffer | undefined>
    json(): Promise<any>
    text(): Promise<string | undefined>
  }

  interface Connection {
    readonly request: Request
    close(): void
    respondWith(response: Response | Promise<Response>): Promise<void>
  }

  function listen(options?: ListenOptions): AsyncGenerator<Connection, void, unknown>

  export { Response }
  export default listen
}
