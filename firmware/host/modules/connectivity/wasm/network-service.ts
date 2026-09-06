import { NetworkConnectionState } from 'network-state'
import type { NetworkAvailability, NetworkServiceOptions, NetworkState } from 'network-types'
import { StackchanError } from 'stackchan/errors'

export type { NetworkServiceOptions, NetworkState, NetworkStateChanged } from 'network-types'

/** Browser networking does not mean the simulator joined the configured Wi-Fi SSID. */
export class NetworkService {
  static readonly availability: NetworkAvailability = 'unavailable'
  readonly #options: NetworkServiceOptions
  #closed = false
  constructor(options: NetworkServiceOptions = {}) {
    this.#options = { ...options }
  }
  get closed(): boolean {
    return this.#closed
  }
  get state(): NetworkState {
    return this.#closed ? NetworkConnectionState.CLOSED : NetworkConnectionState.IDLE
  }
  matchesCredentials(options: { ssid?: string; password?: string }): boolean {
    return this.#options.ssid === options.ssid && (this.#options.password ?? '') === (options.password ?? '')
  }
  close(): void {
    this.#closed = true
  }
  connect(_onConnected?: () => void, _onError?: (reason?: string) => void): never {
    throw new StackchanError(this.#closed ? 'CLOSED' : 'UNSUPPORTED', 'Wi-Fi is unavailable in the browser simulator')
  }
  scanAndConnect(onConnected?: () => void, onError?: (reason?: string) => void): never {
    return this.connect(onConnected, onError)
  }
}
