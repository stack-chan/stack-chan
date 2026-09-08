import { getSettingsService } from 'loadPreference'
import WebSocket from 'WebSocket'
import requestHttp from 'app-http'
import { AppConnection, type AppServiceScope } from 'app-service-scope'
import { BeaconDataPacket } from 'beacon-packet'
import BLEClient from 'bleclient'
import BLEServer from 'bleserver'
import { Bytes } from 'btutils'
import WiFi from 'ecma-wifi'
import { DelimitedTextStream } from 'http-delimited-stream'
import { HttpServerService } from 'http-server-service'
import { MCPServerService } from 'mcp-server'
import { finiteNumber, StackchanError } from 'stackchan/errors'
import type { AppNetwork, Beacon } from 'stackchan/extensions/network'
import StkServer from 'stk-server'
import { URLSearchParams } from 'url'

type Closeable = { close(): void }
type Advertisement = Closeable & { updateTXT(txt: Map<string, string>): void }
type DiscoveredService = { name: string; host?: string; port?: number; txt?: Map<string, string> }
type Dns = Closeable & {
  claim(options: { host: string; onReady(): void; onError(): void }): Closeable
  advertise(options: {
    host: string
    name: string
    serviceType: string
    port: number
    txt: Map<string, string>
  }): Advertisement
  discover(options: {
    serviceType: string
    onFound(service: DiscoveredService): void
    onUpdate(service: DiscoveredService): void
  }): Closeable
}
type DnsEnvironment = { io: new (options: object) => Dns }
const dnsEnvironment = () =>
  (globalThis as { device?: { network?: { dnssd?: DnsEnvironment } } }).device?.network?.dnssd

type NativeNetwork = Omit<AppNetwork, 'ready' | 'openPeer'>
export default function createNativeNetwork(scope: AppServiceScope): NativeNetwork {
  const open = <T>(create: (owner: AppConnection) => T): T => {
    const owner = new AppConnection(scope)
    try {
      return create(owner)
    } catch (error) {
      void owner.close().catch(scope.report)
      throw error
    }
  }
  return {
    address: () => {
      const wifi = new WiFi({})
      try {
        return wifi.address
      } finally {
        wifi.close()
      }
    },
    request: (request, options) => requestHttp(request, options?.signal),
    stream: (request) =>
      open((owner) => {
        const frames = new DelimitedTextStream(
          request.delimiter,
          request.maxResponseBytes ?? 16_384,
          (bytes) => String.fromArrayBuffer(bytes),
          owner.event(request.onMessage),
        )
        const failed = owner.event(request.onError)
        void owner
          .run((task) =>
            requestHttp({ ...request, maxResponseBytes: 65_536, onChunk: (chunk) => frames.push(chunk) }, task.signal),
          )
          .then(
            () => failed('HTTP stream closed'),
            (error) => {
              if (!owner.closed) failed(String(error))
            },
          )
          .finally(() => owner.close())
          .catch(scope.report)
        return owner
      }),
    connect: (options) =>
      open((owner) => {
        if (!/^wss?:\/\//.test(options.url)) throw new StackchanError('INVALID_ARGUMENT', 'WebSocket URL required')
        const state = owner.event(options.onState)
        let ready = false
        const socket = new WebSocket(options.url)
        owner.own(() => socket.close())
        socket.addEventListener(
          'open',
          owner.event(() => {
            ready = true
            state('connected')
          }),
        )
        socket.addEventListener(
          'close',
          owner.event(() => {
            ready = false
            state('disconnected')
          }),
        )
        socket.addEventListener(
          'error',
          owner.event(() => {
            ready = false
            state('error', 'WebSocket connection failed')
          }),
        )
        socket.addEventListener(
          'message',
          owner.event((message: { data: string }) => {
            if (typeof message.data !== 'string' || message.data.length > 16_384) {
              state('error', 'Invalid WebSocket message')
              return
            }
            options.onMessage(message.data)
          }),
        )
        return {
          close: owner.close,
          send: (message: string) =>
            owner.call(() => {
              if (!ready) throw new StackchanError('BUSY', 'WebSocket is not connected')
              if (typeof message !== 'string' || message.length > 16_384)
                throw new StackchanError('INVALID_ARGUMENT', 'WebSocket message is too long')
              socket.send(message)
            }),
        }
      }),
    serve: (options) =>
      open((owner) => {
        finiteNumber(options.port, 'port', 1, 65_535)
        const server = new HttpServerService({ port: options.port })
        owner.own(() => server.close())
        for (const route of options.routes) {
          if (!['GET', 'POST'].includes(route.method) || !route.path.startsWith('/'))
            throw new StackchanError('INVALID_ARGUMENT', 'Invalid HTTP route')
          server[route.method.toLowerCase()](
            route.path,
            async (context: { req: { text(): Promise<string> }; text(body: string, status: number): unknown }) => {
              try {
                const result = await owner.run(async (task) => {
                  const body = (await context.req.text()) ?? ''
                  return route.handle({ body, form: Object.fromEntries(new URLSearchParams(body)) }, task)
                })
                return context.text(result.body, result.status)
              } catch (error) {
                return context.text(
                  error instanceof Error ? error.message : 'Request failed',
                  (error as StackchanError)?.code === 'BUSY' ? 429 : 500,
                )
              }
            },
          )
        }
        return owner
      }),
    serveTools: (options) =>
      open((owner) => {
        const server = new MCPServerService({
          port: options.port,
          token: getSettingsService().get('mcp.token'),
          tools: options.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: Object.entries(tool.inputSchema.properties).map(([name, field]) => ({
              name,
              type: field.type as 'string',
              description: field.description ?? name,
              required: tool.inputSchema.required.includes(name),
            })),
            handler: (input) => owner.run((task) => tool.execute(input, task)),
          })),
        })
        owner.own(() => server.close())
        if (server.status === 'failed') throw new StackchanError('IO', server.error ?? 'MCP server failed')
        return owner
      }),
    listenStk: (options) =>
      open((owner) => {
        const server = new StkServer({
          onReceive: owner.event(options.onMessage),
          onConnected: owner.event(() => options.onConnection?.(true)),
          onDisconnected: owner.event(() => options.onConnection?.(false)),
        })
        owner.own(() => server.close())
        return owner
      }),
    beacon: (options) =>
      open((owner) => {
        if (!/^[\da-fA-F-]{36}$/.test(options.uuid))
          throw new StackchanError('INVALID_ARGUMENT', 'Beacon UUID required')
        const uuid = new Bytes(options.uuid.replaceAll('-', ''), false)
        let ready = false,
          pending: Beacon | undefined
        let radio: BLEClient | BLEServer
        const advertise = (beacon: Beacon) =>
          owner.call(() => {
            if (options.role !== 'advertiser') throw new StackchanError('UNSUPPORTED', 'Scanner cannot advertise')
            for (const value of [beacon.sequence, beacon.command]) {
              finiteNumber(value, 'beacon field', 0, 65_535)
              if (!Number.isInteger(value))
                throw new StackchanError('INVALID_ARGUMENT', 'Beacon fields must be integers')
            }
            pending = beacon
            if (ready)
              (radio as BLEServer).startAdvertising({
                advertisingData: {
                  flags: 6,
                  manufacturerSpecific: {
                    identifier: 0x004c,
                    data: Array.from(new BeaconDataPacket(uuid, beacon.sequence, beacon.command, -40).payload),
                  },
                },
              })
          })
        if (options.role === 'advertiser') {
          radio = new (class extends BLEServer {
            onReady() {
              if (owner.closed) return
              ready = true
              if (pending) advertise(pending)
            }
            onConnected() {
              this.stopAdvertising()
            }
          })()
        } else {
          const notify = owner.event(options.onBeacon)
          radio = new (class extends BLEClient {
            onReady() {
              if (owner.closed) return
              this.startScanning({ active: true, duplicates: true, filterPolicy: 0, interval: 0x50, window: 0x30 })
            }
            onDiscovered(device: Parameters<BLEClient['onDiscovered']>[0]) {
              const data = device.scanResponse.manufacturerSpecific
              if (data?.identifier !== 0x004c) return
              const parsed = BeaconDataPacket.parse(new Uint8Array(data.data))
              if (parsed.success && parsed.value.uuid.equals(uuid))
                notify({ sequence: parsed.value.major, command: parsed.value.minor })
            }
          })()
        }
        owner.own(() => radio.close())
        return { close: owner.close, advertise }
      }),
    advertiseService: (options) =>
      open((owner) => {
        const environment = dnsEnvironment()
        if (!environment?.io) throw new StackchanError('UNSUPPORTED', 'DNS-SD is unavailable')
        let record: Advertisement | undefined
        const dns = new environment.io(environment)
        owner.own(() => dns.close())
        const claim = dns.claim({
          host: options.host,
          onReady: owner.event(() => {
            const advertisement = dns.advertise({
              host: options.host,
              name: options.name,
              serviceType: options.serviceType,
              port: options.port,
              txt: new Map(Object.entries(options.txt)),
            })
            owner.own(() => advertisement.close())
            record = advertisement
          }),
          onError: owner.event(() => options.onError?.('DNS-SD host name conflict')),
        })
        owner.own(() => claim.close())
        return {
          close: owner.close,
          update: (txt) => owner.call(() => record?.updateTXT(new Map(Object.entries(txt)))),
        }
      }),
    discoverServices: (options) =>
      open((owner) => {
        const environment = dnsEnvironment()
        if (!environment?.io) throw new StackchanError('UNSUPPORTED', 'DNS-SD is unavailable')
        const dns = new environment.io({ ...environment })
        owner.own(() => dns.close())
        const found = owner.event((service: DiscoveredService) =>
          options.onService({
            name: service.name,
            host: service.host,
            port: service.port,
            txt: Object.fromEntries(service.txt ?? []),
          }),
        )
        const discovery = dns.discover({ serviceType: options.serviceType, onFound: found, onUpdate: found })
        owner.own(() => discovery.close())
        return owner
      }),
  }
}
