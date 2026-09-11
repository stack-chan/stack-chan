import type { AppContext } from 'stackchan/app'
import { StackchanError } from 'stackchan/errors'
import type { OperationOptions, TaskContext, Unsubscribe } from 'stackchan/task'

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }
/** Closing a handle also releases its subscriptions. Repeated closes are safe. */
export interface Connection {
  close(): Promise<void>
}
export type Peer = Readonly<{ id: string; name?: string; secure: boolean }>
export type PeerMessage = Readonly<{ id: string; peer: Peer; type: string; payload: JsonValue }>
export type PeerOptions = Readonly<{
  transport?: 'espnow' | 'ble'
  service: string
  displayName?: string
  sharedKey?: string
}>
export interface PeerConnection extends Connection {
  discover(options?: OperationOptions & { timeoutMs?: number }): Promise<readonly Peer[]>
  send(peerId: string, type: string, payload: JsonValue, options?: OperationOptions): Promise<void>
  broadcast(type: string, payload: JsonValue, options?: OperationOptions): Promise<void>
  onMessage(type: string, handler: (message: PeerMessage) => void): Unsubscribe
}
export interface SocketConnection extends Connection {
  send(message: string): void
}
export type SocketOptions = Readonly<{
  url: string
  onMessage(message: string): void
  onState?(state: 'connected' | 'disconnected' | 'error', reason?: string): void
}>
export type HttpResponse = Readonly<{ status: number; body: string; headers?: Readonly<Record<string, string>> }>
export type HttpRequest = Readonly<{
  url: string
  method?: 'GET' | 'POST' | 'DELETE'
  headers?: Readonly<Record<string, string>>
  body?: string
  timeoutMs?: number
  maxResponseBytes?: number
}>
export type HttpRoute = Readonly<{
  method: 'GET' | 'POST'
  path: string
  handle(
    request: { body: string; form: Readonly<Record<string, string>> },
    task: TaskContext,
  ): HttpResponse | Promise<HttpResponse>
}>
export type Beacon = Readonly<{ sequence: number; command: number }>
export interface BeaconConnection extends Connection {
  advertise(beacon: Beacon): void
}
export type ServiceRecord = Readonly<{
  name: string
  host?: string
  port?: number
  txt: Readonly<Record<string, string>>
}>
export interface ServiceAdvertisement extends Connection {
  update(txt: Readonly<Record<string, string>>): void
}
export type Tool = Readonly<{
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, { type: string; description?: string; enum?: readonly string[] }>
    required: readonly string[]
  }
  execute(input: Record<string, unknown>, task: TaskContext): string | Promise<string>
}>

/** Protocol operations owned by this app. Native sockets and radios stay in the host. */
export interface AppNetwork {
  ready(options?: OperationOptions): Promise<void>
  address(): string | undefined
  request(request: HttpRequest, options?: OperationOptions): Promise<HttpResponse>
  /** Delimited UTF-8 messages from a continuous HTTP response. timeoutMs is an idle timeout. */
  stream(
    request: HttpRequest & { delimiter: string; onMessage(message: string): void; onError?(reason: string): void },
  ): Connection
  connect(options: SocketOptions): SocketConnection
  openPeer(options: PeerOptions): Promise<PeerConnection>
  serve(options: { port: number; routes: readonly HttpRoute[] }): Connection
  serveTools(options: { port: number; tools: readonly Tool[] }): Connection
  /** Stack-chan STK GATT service; JSON payloads up to 2048 bytes. Invalid packets are reported and skipped. */
  listenStk(options: { onMessage(message: JsonValue): void; onConnection?(connected: boolean): void }): Connection
  /** Apple iBeacon framing; caller supplies the application UUID. */
  beacon(options: { role: 'advertiser' | 'scanner'; uuid: string; onBeacon?(beacon: Beacon): void }): BeaconConnection
  advertiseService(options: {
    host: string
    name: string
    serviceType: string
    port: number
    txt: Readonly<Record<string, string>>
    onError?(reason: string): void
  }): ServiceAdvertisement
  discoverServices(options: { serviceType: string; onService(service: ServiceRecord): void }): Connection
}
export function network(app: AppContext): AppNetwork {
  const value = (app as AppContext & { network?: AppNetwork }).network
  if (!value) throw new StackchanError('UNSUPPORTED', 'Network services are unavailable')
  return value
}
