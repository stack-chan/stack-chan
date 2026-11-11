declare module 'realtimeConversation/http-core' {
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
  export function createClosingClient(
    Client: unknown,
    options: object,
  ): import('stackchan-ai-http-stream').ResponseConnection
}
