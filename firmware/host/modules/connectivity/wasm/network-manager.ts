export type StartNetworkConnectionOptions = {
  ssid: string
  password: string
  onStateChanged?: (state: unknown) => void
  onConnected?: () => void
  onError?: (reason?: string) => void
}

type WasmNetworkService = {
  close(): void
}

let currentNetworkService: WasmNetworkService | undefined

export function startNetworkConnection(options: StartNetworkConnectionOptions): WasmNetworkService {
  currentNetworkService = {
    close() {
      currentNetworkService = undefined
    },
  }
  trace(`[network] Wi-Fi is unsupported on wasm: ${options.ssid}\n`)
  options.onError?.('unsupported')
  return currentNetworkService
}

export function stopNetworkConnection(): void {
  currentNetworkService?.close()
  currentNetworkService = undefined
}

export function getNetworkConnection(): WasmNetworkService | undefined {
  return currentNetworkService
}
