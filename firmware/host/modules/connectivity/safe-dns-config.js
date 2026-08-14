import 'wssclient/config'
import { serializeReadableBursts } from 'safe-readable-socket'

const network = { ...device.network }
for (const name of ['http', 'https', 'ws', 'wss']) {
  const transport = network[name]
  const Socket = transport?.dns?.socket?.io
  if (!Socket) continue
  const dns = { ...transport.dns }
  dns.socket = { ...dns.socket, io: serializeReadableBursts(Socket) }
  network[name] = { ...transport, dns }
}
globalThis.device = Object.freeze({ ...device, network }, true)
