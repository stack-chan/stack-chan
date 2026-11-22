import { createClosingClient, guardSocketCallbacks } from 'realtimeConversation/http-core'
import type { HTTPClientProvider } from 'embedded:network/http/client'
import { streamResponse } from 'stackchan-ai-http-stream'
import Timer from 'timer'
import { URL } from 'url'

declare const device: { network: { https: { client: HTTPClientProvider }; http: { client: HTTPClientProvider } } }

export function createResponseTransport(
  endpoint: string,
  apiKey: string,
  timeoutMs: number,
  maxPendingBytes: number,
  extraHeaders?: Readonly<Record<string, string>>,
) {
  const url = new URL(endpoint)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw Error('unsupported endpoint protocol')
  if (url.protocol === 'http:' && apiKey) throw Error('credentials require HTTPS')
  return streamResponse(
    {
      path: url.pathname + url.search,
      extraHeaders,
      schedule: (task, ms) => Timer.set(task, ms),
      clear: (timer) => Timer.clear(timer),
      connect(onError) {
        const secure = url.protocol === 'https:'
        const provider = secure ? device.network.https.client : device.network.http.client
        const socket = provider.socket
        return createClosingClient(provider.io, {
          ...provider,
          host: url.hostname,
          port: Number(url.port) || (secure ? 443 : 80),
          ...(secure && 'TCP' in socket && socket.TCP
            ? { socket: { ...socket, TCP: { ...socket.TCP, io: guardSocketCallbacks(socket.TCP.io) } } }
            : {}),
          onError,
        })
      },
    },
    apiKey,
    timeoutMs,
    maxPendingBytes,
  )
}
