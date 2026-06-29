export type NetworkState =
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'syncing-time'
  | 'connected'
  | 'reconnecting'
  | 'failed'
  | 'closed'

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
    this.#onStateChanged?.('closed')
  }
  connect(onConnected?: () => void, _onError?: (message: string) => void) {
    this.#onStateChanged?.('connected')
    onConnected?.()
  }
  scanAndConnect(onConnected?: () => void, _onError?: (message: string) => void) {
    this.#onStateChanged?.('connected')
    onConnected?.()
  }
}
