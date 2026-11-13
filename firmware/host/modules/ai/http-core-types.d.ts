declare module 'realtimeConversation/http-core' {
  import type HTTPClient from 'embedded:network/http/client'
  import type { ClientOptions } from 'embedded:network/http/client'
  export function requestHttps(
    request: {
      host: string
      port: number
      path: string
      timeoutMs: number
      body: ArrayBuffer
      headers: Iterable<readonly [string, string]>
      certificate?: ArrayBuffer
    },
    platform: object,
  ): Promise<{ status: number; body: ArrayBuffer }>
  export function guardSocketCallbacks<T>(Socket: T): T
  export function createClosingClient(Client: unknown, options: ClientOptions): Pick<HTTPClient, 'request' | 'close'>
}
