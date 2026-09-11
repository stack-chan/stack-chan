export let connections = 0
export function resetNativeNetwork() {
  connections = 0
}

export default class UnexpectedConnection {
  status = 'running'
  error?: string
  close() {}
  send(_message: string) {}
  addEventListener(_name: string, _callback: (event: { data: string }) => void) {}
  constructor(..._args: unknown[]) {
    connections++
    throw new Error('unexpected device connection')
  }
}
export const Bytes = UnexpectedConnection
export const HttpServerService = UnexpectedConnection
export const MCPServerService = UnexpectedConnection
export const DelimitedTextStream = UnexpectedConnection
export const BeaconDataPacket = UnexpectedConnection
export function getSettingsService() {
  throw new Error('unexpected settings access')
}
export const URLSearchParams = globalThis.URLSearchParams
