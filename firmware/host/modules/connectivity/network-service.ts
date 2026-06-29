import config from 'mc/config'
import Net from 'net'
import {
  NetworkConnectionState,
  NetworkConnectionStateMachine,
  type NetworkConnectionState as NetworkConnectionStateValue,
} from 'network-state'
import SNTP from 'sntp'
import Time from 'time'
import Timer from 'timer'
import WiFi from 'wifi/connection'

const MAX_SCANS = 3
const DEFAULT_CONNECTION_TIMEOUT_MS = 15000
const DEFAULT_RECONNECT_DELAY_MS = 3000

export type NetworkState = NetworkConnectionStateValue
export type NetworkStateChanged = (state: NetworkState, reason?: string) => void

export type NetworkServiceOptions = {
  ssid?: string
  password?: string
  connectionTimeoutMs?: number
  reconnectDelayMs?: number
  onStateChanged?: NetworkStateChanged
}

export class NetworkService {
  #ssid?: string
  #password?: string
  #connectionTimeoutMs: number
  #reconnectDelayMs: number
  #stateMachine = new NetworkConnectionStateMachine({ maxScans: MAX_SCANS })
  #wifi?: WiFi
  #connectionTimeout
  #reconnectTimer
  #closed = false
  #handleStateChanged: NetworkStateChanged = () => {}
  #handleConnected: () => void = () => {}
  #handleError: (reason?: string) => void = () => {}
  onConnected: () => void = () => {}
  onError: (reason?: string) => void = () => {}

  constructor(options: NetworkServiceOptions) {
    this.#ssid = options.ssid
    this.#password = options.password
    this.#connectionTimeoutMs = options.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS
    this.#reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS
    this.#handleStateChanged = options.onStateChanged ?? (() => {})
  }

  get state(): NetworkState {
    return this.#stateMachine.state
  }

  close() {
    this.#closed = true
    this.#clearConnectionTimeout()
    this.#clearReconnectTimer()
    this.#wifi?.close()
    this.#wifi = undefined
    this.#transition({ type: 'closed' })
  }

  connect(onConnected: () => void = this.onConnected, onError: (message?: string) => void = this.onError) {
    this.#handleConnected = onConnected
    this.#handleError = onError
    if (this.#ssid == null) {
      this.#fail('ssid not set')
      return
    }
    this.#closed = false
    this.#clearReconnectTimer()
    this.#startConnectionAttempt()
  }

  #startConnectionAttempt() {
    this.#clearConnectionTimeout()
    this.#transition({ type: 'connect-requested' })
    this.#startConnectionTimeout()
    WiFi.mode = WiFi.Mode.station
    this.#wifi?.close()
    this.#wifi = new WiFi({ ssid: this.#ssid, password: this.#password }, (msg) => {
      trace(`WiFi ${msg}\n`)
      switch (msg) {
        case WiFi.connected:
          trace(`Connected to: ${Net.get('SSID')}\n`)
          break

        case WiFi.gotIP:
          trace(`Got IP address: ${Net.get('IP')}\n`)
          this.#clearConnectionTimeout()
          this.#transition({ type: 'got-ip' })

          // Setting time for TLS connection
          if (!config.sntp || Date.now() > 1672722071_000) {
            trace('Time·already configured, skipping\n')
            this.#handleConnected?.()
            break
          }
          this.#transition({ type: 'time-sync-started' })
          this.#startConnectionTimeout()
          new SNTP({ host: config.sntp }, (message, value) => {
            if (SNTP.time === message) {
              trace(`Got time from: ${config.sntp}\n`)
              if (typeof value === 'number') {
                Time.set(value)
                this.#clearConnectionTimeout()
                this.#transition({ type: 'time-synced' })
                this.#handleConnected?.()
              } else {
                this.#fail('Failed to get time')
              }
            } else if (SNTP.error === (message as -1 | 1 | 2)) {
              // workaround for the type mistake
              this.#fail('Failed to get time')
            }
          })
          break
        case WiFi.disconnected:
          if (this.#closed) break
          this.#clearConnectionTimeout()
          this.#transition({ type: 'disconnected' }, 'disconnected')
          if (this.#stateMachine.connectionEstablished) {
            this.#scheduleReconnect()
          } else {
            this.#handleError?.('connection failed')
          }
          break
      }
    })
  }

  scanAndConnect(onConnected: () => void = this.onConnected, onError: (message?: string) => void = this.onError) {
    this.#handleConnected = onConnected
    this.#handleError = onError
    if (this.#ssid == null) {
      this.#fail('ssid not set')
      return
    }
    WiFi.mode = WiFi.Mode.station
    this.#transition({ type: 'scan-started' })
    WiFi.scan({}, (item: { ssid: string } | null) => {
      if (this.state === NetworkConnectionState.CONNECTING) {
        return
      }

      if (item != null) {
        if (item.ssid === this.#ssid) {
          this.connect(onConnected, onError)
        }
      } else {
        // scan finished
        const state = this.#transition({ type: 'scan-finished' })
        if (state === NetworkConnectionState.FAILED) {
          const message = `Access point "${this.#ssid}" not found`
          trace(`${message}\n`)
          this.#handleError(message)
          return
        }
        trace('retrying\n')
        this.scanAndConnect(this.#handleConnected, this.#handleError)
      }
    })
  }

  #scheduleReconnect() {
    if (this.#closed || this.#reconnectTimer != null) return
    trace('WiFi reconnecting...\n')
    this.#reconnectTimer = Timer.set(() => {
      this.#reconnectTimer = undefined
      if (!this.#closed) this.#startConnectionAttempt()
    }, this.#reconnectDelayMs)
  }

  #startConnectionTimeout() {
    this.#clearConnectionTimeout()
    this.#connectionTimeout = Timer.set(() => {
      this.#connectionTimeout = undefined
      this.#fail('connection timeout')
    }, this.#connectionTimeoutMs)
  }

  #clearConnectionTimeout() {
    if (this.#connectionTimeout == null) return
    Timer.clear(this.#connectionTimeout)
    this.#connectionTimeout = undefined
  }

  #clearReconnectTimer() {
    if (this.#reconnectTimer == null) return
    Timer.clear(this.#reconnectTimer)
    this.#reconnectTimer = undefined
  }

  #fail(reason: string) {
    this.#clearConnectionTimeout()
    this.#transition({ type: 'failed' }, reason)
    this.#handleError?.(reason)
  }

  #transition(event: Parameters<NetworkConnectionStateMachine['transition']>[0], reason?: string): NetworkState {
    const state = this.#stateMachine.transition(event)
    this.#handleStateChanged(state, reason)
    return state
  }
}
