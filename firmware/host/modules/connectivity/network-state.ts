export const NetworkConnectionState = Object.freeze({
  IDLE: 0,
  SCANNING: 1,
  CONNECTING: 2,
  SYNCING_TIME: 3,
  CONNECTED: 4,
  RECONNECTING: 5,
  FAILED: 6,
  CLOSED: 7,
} as const)

export type NetworkConnectionState = (typeof NetworkConnectionState)[keyof typeof NetworkConnectionState]

const networkConnectionStateNames = Object.freeze([
  'idle',
  'scanning',
  'connecting',
  'syncing-time',
  'connected',
  'reconnecting',
  'failed',
  'closed',
] as const)
export type NetworkConnectionStateName = (typeof networkConnectionStateNames)[number]

export function networkConnectionStateToName(state: NetworkConnectionState): NetworkConnectionStateName {
  return networkConnectionStateNames[state] ?? 'failed'
}

export type NetworkTransition =
  | { type: 'scan-started' }
  | { type: 'scan-finished' }
  | { type: 'connect-requested' }
  | { type: 'got-ip' }
  | { type: 'time-sync-started' }
  | { type: 'time-synced' }
  | { type: 'disconnected' }
  | { type: 'failed' }
  | { type: 'timeout' }
  | { type: 'closed' }

export class NetworkConnectionStateMachine {
  #state: NetworkConnectionState = NetworkConnectionState.IDLE
  #connectionEstablished = false
  #scanAttempts = 0
  #maxScans: number

  constructor(options: { maxScans?: number } = {}) {
    this.#maxScans = options.maxScans ?? 3
  }

  get state(): NetworkConnectionState {
    return this.#state
  }

  get connectionEstablished(): boolean {
    return this.#connectionEstablished
  }

  get scanAttempts(): number {
    return this.#scanAttempts
  }

  transition(event: NetworkTransition): NetworkConnectionState {
    switch (event.type) {
      case 'scan-started':
        this.#state = NetworkConnectionState.SCANNING
        break
      case 'scan-finished':
        this.#scanAttempts += 1
        this.#state =
          this.#scanAttempts > this.#maxScans ? NetworkConnectionState.FAILED : NetworkConnectionState.SCANNING
        break
      case 'connect-requested':
        this.#state = NetworkConnectionState.CONNECTING
        break
      case 'got-ip':
        this.#connectionEstablished = true
        this.#scanAttempts = 0
        this.#state = NetworkConnectionState.CONNECTED
        break
      case 'time-sync-started':
        this.#state = NetworkConnectionState.SYNCING_TIME
        break
      case 'time-synced':
        this.#connectionEstablished = true
        this.#state = NetworkConnectionState.CONNECTED
        break
      case 'disconnected':
        this.#state = this.#connectionEstablished ? NetworkConnectionState.RECONNECTING : NetworkConnectionState.FAILED
        break
      case 'failed':
      case 'timeout':
        this.#state = NetworkConnectionState.FAILED
        break
      case 'closed':
        this.#connectionEstablished = false
        this.#state = NetworkConnectionState.CLOSED
        break
    }
    return this.#state
  }
}
