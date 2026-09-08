import type { StackchanErrorCode } from '../../../sdk/errors.js'
import type { LocalPeerCapability } from './local-peer-types.js'
import type { NetworkConnectionState } from './network-state.js'

export type NetworkState = NetworkConnectionState
export type NetworkAvailability = 'native' | 'simulated' | 'unavailable'
export type NetworkReadyResult =
  | { status: 'connected' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string; code: StackchanErrorCode }
export type NetworkStateChanged = (state: NetworkState, reason?: string) => void
export type NetworkServiceOptions = {
  ssid?: string
  password?: string
  connectionTimeoutMs?: number
  reconnectDelayMs?: number
  onStateChanged?: NetworkStateChanged
}
export type StartNetworkConnectionOptions = NetworkServiceOptions & {
  onConnected?: () => void
  onError?: (reason?: string) => void
  scanBeforeConnect?: boolean
}
/** A consumer owns this handle, never the shared physical Wi-Fi adapter. */
export type NetworkConnection = {
  readonly state: NetworkState
  readonly closed: boolean
  close(): void
}

export type NetworkCapability = {
  readonly availability?: NetworkAvailability
  readonly state?: NetworkState
  /**
   * Resolves when the host boot Wi-Fi attempt connects, is skipped because credentials are unavailable,
   * or fails with an observable reason.
   */
  ready: Promise<NetworkReadyResult>
}

export type ConnectivityCapability = {
  network?: NetworkCapability
  /** Nearby peer messaging over a platform-supported transport such as ESP-NOW or BLE Serial. */
  localPeer?: LocalPeerCapability
}
