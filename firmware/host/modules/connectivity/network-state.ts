export type NetworkConnectionState =
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'syncing-time'
  | 'connected'
  | 'reconnecting'
  | 'failed'
  | 'closed'

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
  #state: NetworkConnectionState = 'idle'
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
        this.#state = 'scanning'
        break
      case 'scan-finished':
        this.#scanAttempts += 1
        this.#state = this.#scanAttempts > this.#maxScans ? 'failed' : 'scanning'
        break
      case 'connect-requested':
        this.#state = 'connecting'
        break
      case 'got-ip':
        this.#connectionEstablished = true
        this.#scanAttempts = 0
        this.#state = 'connected'
        break
      case 'time-sync-started':
        this.#state = 'syncing-time'
        break
      case 'time-synced':
        this.#connectionEstablished = true
        this.#state = 'connected'
        break
      case 'disconnected':
        this.#state = this.#connectionEstablished ? 'reconnecting' : 'failed'
        break
      case 'failed':
      case 'timeout':
        this.#state = 'failed'
        break
      case 'closed':
        this.#connectionEstablished = false
        this.#state = 'closed'
        break
    }
    return this.#state
  }
}
