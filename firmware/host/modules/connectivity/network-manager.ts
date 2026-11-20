import { NetworkService, type NetworkServiceOptions } from 'network-service'

export type StartNetworkConnectionOptions = NetworkServiceOptions & {
  onConnected?: () => void
  onError?: (reason?: string) => void
  scanBeforeConnect?: boolean
}

let currentNetworkService: NetworkService | undefined

export function startNetworkConnection(options: StartNetworkConnectionOptions): NetworkService {
  if (currentNetworkService?.matchesCredentials(options)) {
    currentNetworkService.join(options.onConnected, options.onError)
    return currentNetworkService
  }
  stopNetworkConnection()
  currentNetworkService = new NetworkService(options)
  if (options.scanBeforeConnect) {
    currentNetworkService.scanAndConnect(options.onConnected, options.onError)
  } else {
    currentNetworkService.connect(options.onConnected, options.onError)
  }
  return currentNetworkService
}

export function stopNetworkConnection(): void {
  currentNetworkService?.close()
  currentNetworkService = undefined
}

export function getNetworkConnection(): NetworkService | undefined {
  return currentNetworkService
}
