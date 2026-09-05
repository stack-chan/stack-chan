import WiFi from 'ecma-wifi'
import config from 'mc/config'
import {
  NetworkConnectionState,
  NetworkConnectionStateMachine,
  type NetworkConnectionState as NetworkConnectionStateValue,
} from 'network-state'
import Time from 'time'
import Timer from 'timer'

type NtpClient = { getTime(callback: (error: unknown, time?: number) => void): void; close(): void }
declare const device: { network: { ntp: { client: { io: new (options: object) => NtpClient } } } }

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
  #wifi: WiFi
  #connectionTimeout
  #reconnectTimer
  #closed = false
  #ntp: NtpClient | undefined
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
    this.#wifi = new WiFi({
      onChanged: (property: string) => {
        this.#handleWiFiChanged(property)
      },
    })
  }

  get state(): NetworkState {
    return this.#stateMachine.state
  }

  matchesCredentials(options: { ssid?: string; password?: string }): boolean {
    return this.#ssid === options.ssid && this.#password === options.password
  }

  join(onConnected?: () => void, onError?: (message?: string) => void): void {
    if (this.state === NetworkConnectionState.CONNECTED) {
      onConnected?.()
    } else if (this.state === NetworkConnectionState.FAILED) {
      onError?.('connection failed')
    } else {
      const previousConnected = this.#handleConnected
      const previousError = this.#handleError
      this.#handleConnected = () => {
        previousConnected?.()
        onConnected?.()
      }
      this.#handleError = (reason) => {
        previousError?.(reason)
        onError?.(reason)
      }
    }
  }

  close() {
    this.#closed = true
    this.#closeNtp()
    this.#clearConnectionTimeout()
    this.#clearReconnectTimer()
    this.#wifi.disconnect()
    this.#wifi.close()
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
    this.#closeNtp()
    this.#clearConnectionTimeout()
    this.#transition({ type: 'connect-requested' })
    this.#startConnectionTimeout()
    this.#wifi.connect(createWiFiConnectOptions(this.#ssid, this.#password))
  }

  scanAndConnect(onConnected: () => void = this.onConnected, onError: (message?: string) => void = this.onError) {
    this.#handleConnected = onConnected
    this.#handleError = onError
    if (this.#ssid == null) {
      this.#fail('ssid not set')
      return
    }
    this.#transition({ type: 'scan-started' })
    let found = false
    this.#wifi.scan({
      onFound: (item: { ssid?: string; SSID?: string }) => {
        const ssid = item.ssid ?? item.SSID
        if (ssid !== this.#ssid || found) return
        found = true
        this.connect(onConnected, onError)
      },
      onComplete: () => {
        if (found) return
        const state = this.#transition({ type: 'scan-finished' })
        if (state === NetworkConnectionState.FAILED) {
          const message = `Access point "${this.#ssid}" not found`
          trace(`${message}\n`)
          this.#handleError(message)
          return
        }
        trace('retrying\n')
        this.scanAndConnect(this.#handleConnected, this.#handleError)
      },
    })
  }

  #handleWiFiChanged(_property: string): void {
    const connection = this.#wifi.connection
    trace(`WiFi ${connection}\n`)
    if (connection >= 500) {
      trace(`Got IP address: ${this.#wifi.address}\n`)
      this.#handleGotIP()
      return
    }
    if (connection >= 400) {
      trace(`Connected to: ${this.#wifi.SSID}\n`)
      return
    }
    if (connection <= 200) {
      if (this.#closed) return
      this.#clearConnectionTimeout()
      this.#closeNtp()
      this.#transition({ type: 'disconnected' }, 'disconnected')
      if (this.#stateMachine.connectionEstablished) {
        this.#scheduleReconnect()
      } else {
        this.#handleError?.('connection failed')
      }
    }
  }

  #handleGotIP(): void {
    if (this.#closed || this.state === NetworkConnectionState.CONNECTED || this.#ntp) return
    this.#clearConnectionTimeout()
    this.#transition({ type: 'got-ip' })

    // Setting time for TLS connection
    const sntpHost = typeof config.sntp === 'string' ? config.sntp : undefined
    if (!sntpHost || Date.now() > 1672722071_000) {
      trace('Time·already configured, skipping\n')
      this.#handleConnected?.()
      return
    }
    this.#transition({ type: 'time-sync-started' })
    this.#startConnectionTimeout()
    try {
      const provider = device.network.ntp.client
      const ntp = new provider.io({ ...provider, servers: [sntpHost] })
      this.#ntp = ntp
      ntp.getTime((error, value) => {
        if (this.#closed || this.#ntp !== ntp) return
        this.#closeNtp()
        if (error || typeof value !== 'number' || !Number.isFinite(value)) {
          this.#fail('Failed to get time')
          return
        }
        Time.set(value / 1000)
        this.#clearConnectionTimeout()
        this.#transition({ type: 'time-synced' })
        this.#handleConnected?.()
      })
    } catch {
      this.#fail('Failed to get time')
    }
  }

  #closeNtp() {
    const ntp = this.#ntp
    this.#ntp = undefined
    ntp?.close()
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
    this.#closeNtp()
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

function createWiFiConnectOptions(
  ssid: string,
  password?: string,
): { SSID: string; password?: string; secure?: boolean } {
  if (password == null || password.length === 0) {
    return { SSID: ssid }
  }
  return { SSID: ssid, password, secure: true }
}
