import { NetworkConnectionState, type NetworkConnectionState as NetworkConnectionStateValue } from 'network-state'

export type NetworkState = NetworkConnectionStateValue
export type NetworkStateChanged = (state: NetworkState, reason?: string) => void

export type NetworkServiceOptions = {
  onStateChanged?: NetworkStateChanged
}

export class NetworkService {
  #onStateChanged?: NetworkStateChanged
  constructor(options: NetworkServiceOptions = {}) {
    this.#onStateChanged = options.onStateChanged
  }
  close() {
    this.#onStateChanged?.(NetworkConnectionState.CLOSED)
  }
  connect(onConnected?: () => void, _onError?: (message: string) => void) {
    this.#onStateChanged?.(NetworkConnectionState.CONNECTED)
    onConnected?.()
  }
  scanAndConnect(onConnected?: () => void, _onError?: (message: string) => void) {
    this.#onStateChanged?.(NetworkConnectionState.CONNECTED)
    onConnected?.()
  }
}
