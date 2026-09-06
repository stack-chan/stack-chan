import WiFi from 'ecma-wifi'
import config from 'mc/config'
import { NetworkConnectionState, NetworkConnectionStateMachine } from 'network-state'
import type { NetworkAvailability, NetworkServiceOptions, NetworkState } from 'network-types'
import { finiteNumber, StackchanError } from 'stackchan/errors'
import Time from 'time'
import Timer from 'timer'

export type { NetworkServiceOptions, NetworkState, NetworkStateChanged } from 'network-types'

type NtpClient = { getTime(callback: (error: unknown, time?: number) => void): void; close(): void }
declare const device: { network: { ntp: { client: { io: new (options: object) => NtpClient } } } }

/** Owns one Wi-Fi adapter. A closed instance cannot reconnect or consume a late scan result. */
export class NetworkService {
  static readonly availability: NetworkAvailability =
    (WiFi as unknown as { availability?: NetworkAvailability }).availability ?? 'native'
  readonly #options: NetworkServiceOptions
  readonly #timeoutMs: number
  readonly #reconnectDelayMs: number
  readonly #wifi: WiFi
  #stateMachine = new NetworkConnectionStateMachine({ maxScans: 3 })
  #closed = false
  #cleanupError?: StackchanError
  #active = false
  #epoch = 0
  #deadline?: ReturnType<typeof Timer.set>
  #retry?: ReturnType<typeof Timer.set>
  #ntp?: NtpClient
  #connected: () => void = () => {}
  #error: (reason?: string) => void = () => {}
  onConnected: () => void = () => {}
  onError: (reason?: string) => void = () => {}

  constructor(options: NetworkServiceOptions) {
    this.#options = { ...options }
    this.#timeoutMs = options.connectionTimeoutMs ?? 15_000
    this.#reconnectDelayMs = options.reconnectDelayMs ?? 3000
    finiteNumber(this.#timeoutMs, 'connectionTimeoutMs', 1, 120_000)
    finiteNumber(this.#reconnectDelayMs, 'reconnectDelayMs', 0, 60_000)
    this.#wifi = new WiFi({ onChanged: () => this.#changed() })
  }

  get state(): NetworkState {
    return this.#stateMachine.state
  }
  get closed(): boolean {
    return this.#closed
  }
  matchesCredentials(options: { ssid?: string; password?: string }): boolean {
    return this.#options.ssid === options.ssid && (this.#options.password ?? '') === (options.password ?? '')
  }

  connect(onConnected = this.onConnected, onError = this.onError): void {
    const epoch = this.#begin(onConnected, onError)
    this.#connectPhysical(epoch)
  }

  scanAndConnect(onConnected = this.onConnected, onError = this.onError): void {
    const epoch = this.#begin(onConnected, onError)
    this.#scan(epoch)
  }

  close(): void {
    if (this.#closed) {
      if (this.#cleanupError) throw this.#cleanupError
      return
    }
    this.#closed = true
    this.#active = false
    this.#epoch++
    this.#connected = () => {}
    this.#error = () => {}
    this.onConnected = () => {}
    this.onError = () => {}
    let failure: unknown
    let failed = false
    for (const close of [
      () => this.#closeNtp(),
      () => this.#clearTimers(),
      () => this.#wifi.disconnect(),
      () => this.#wifi.close(),
    ]) {
      try {
        close()
      } catch (error) {
        if (!failed) {
          failure = error
          failed = true
        }
      }
    }
    this.#transition({ type: 'closed' })
    this.#options.onStateChanged = undefined
    if (failed) this.#recordCleanupError(failure)
    if (this.#cleanupError) throw this.#cleanupError
  }

  #begin(onConnected: () => void, onError: (reason?: string) => void): number {
    if (this.#closed) throw new StackchanError('CLOSED', 'Wi-Fi adapter is closed')
    if (this.#cleanupError) throw this.#cleanupError
    this.#active = false
    const epoch = ++this.#epoch
    this.#closeNtp()
    this.#clearTimers()
    this.#connected = onConnected
    this.#error = onError
    this.#stateMachine = new NetworkConnectionStateMachine({ maxScans: 3 })
    if (!this.#options.ssid) throw new StackchanError('CONFIG', 'Wi-Fi SSID is missing')
    this.#active = true
    // One deadline covers scanning, association, IP acquisition and optional NTP.
    this.#deadline = Timer.set(() => {
      this.#deadline = undefined
      if (this.#valid(epoch)) this.#fail('connection timeout')
    }, this.#timeoutMs)
    return epoch
  }

  #valid(epoch: number): boolean {
    return !this.#closed && this.#active && this.#epoch === epoch
  }

  #connectPhysical(epoch: number): void {
    if (!this.#valid(epoch)) return
    this.#transition({ type: 'connect-requested' })
    if (!this.#valid(epoch)) return
    const password = this.#options.password
    try {
      this.#wifi.connect(password ? { SSID: this.#options.ssid, password, secure: true } : { SSID: this.#options.ssid })
    } catch {
      this.#fail('Wi-Fi connection failed')
    }
  }

  #scan(epoch: number): void {
    if (!this.#valid(epoch)) return
    this.#transition({ type: 'scan-started' })
    if (!this.#valid(epoch)) return
    let found = false
    let completed = false
    try {
      this.#wifi.scan({
        onFound: (item: { ssid?: string; SSID?: string }) => {
          if (!this.#valid(epoch) || completed || found || (item.ssid ?? item.SSID) !== this.#options.ssid) return
          found = true
          this.#connectPhysical(epoch)
        },
        onComplete: () => {
          if (!this.#valid(epoch) || completed || found) return
          completed = true
          if (this.#transition({ type: 'scan-finished' }) === NetworkConnectionState.FAILED) {
            this.#fail(`Access point "${this.#options.ssid}" not found`)
            return
          }
          if (!this.#valid(epoch)) return
          this.#retry = Timer.set(() => {
            this.#retry = undefined
            this.#scan(epoch)
          }, 0)
        },
      })
    } catch {
      this.#fail('Wi-Fi scan failed')
    }
  }

  #changed(): void {
    if (this.#closed || !this.#active) return
    const connection = this.#wifi.connection
    if (connection >= 500) {
      this.#gotIP()
      return
    }
    if (connection > 200 || this.state === NetworkConnectionState.SCANNING) return
    const reconnect = this.#stateMachine.connectionEstablished
    this.#active = false
    this.#epoch++
    this.#clearTimers()
    try {
      this.#closeNtp()
    } catch {
      this.#fail('Time synchronization cleanup failed')
      return
    }
    this.#transition({ type: 'disconnected' }, 'disconnected')
    if (this.#closed) return
    if (!reconnect) {
      this.#emitError('connection failed')
      return
    }
    this.#retry = Timer.set(() => {
      this.#retry = undefined
      if (this.#closed) return
      try {
        this.connect(this.#connected, this.#error)
      } catch {
        this.#fail('Wi-Fi reconnection failed')
      }
    }, this.#reconnectDelayMs)
  }

  #gotIP(): void {
    if (this.state === NetworkConnectionState.CONNECTED || this.#ntp) return
    const sntpHost = typeof config.sntp === 'string' ? config.sntp : undefined
    if (!sntpHost || Date.now() > 1672722071_000) {
      this.#complete()
      return
    }
    const epoch = this.#epoch
    this.#transition({ type: 'time-sync-started' })
    if (!this.#valid(epoch)) return
    try {
      const provider = device.network.ntp.client
      const ntp = new provider.io({ ...provider, servers: [sntpHost] })
      this.#ntp = ntp
      ntp.getTime((error, value) => {
        if (!this.#valid(epoch) || this.#ntp !== ntp) return
        try {
          this.#closeNtp()
        } catch {
          this.#fail('Time synchronization cleanup failed')
          return
        }
        if (error || typeof value !== 'number' || !Number.isFinite(value)) {
          this.#fail('Failed to get time')
          return
        }
        try {
          Time.set(value / 1000)
        } catch {
          this.#fail('Failed to set time')
          return
        }
        this.#complete()
      })
    } catch {
      this.#fail('Failed to get time')
    }
  }

  #complete(): void {
    if (this.#closed || !this.#active) return
    this.#clearTimers()
    this.#transition({ type: 'time-synced' })
    if (!this.#closed && this.#active) {
      try {
        this.#connected()
      } catch {
        trace('[network] connection observer failed\n')
      }
    }
  }

  #closeNtp(): void {
    const ntp = this.#ntp
    this.#ntp = undefined
    try {
      ntp?.close()
    } catch (error) {
      this.#recordCleanupError(error)
      throw this.#cleanupError
    }
  }
  #recordCleanupError(cause: unknown): void {
    this.#cleanupError ??= new StackchanError('IO', 'Wi-Fi resources could not be closed', { cause })
  }
  #clearTimers(): void {
    if (this.#deadline !== undefined) Timer.clear(this.#deadline)
    if (this.#retry !== undefined) Timer.clear(this.#retry)
    this.#deadline = undefined
    this.#retry = undefined
  }

  #fail(reason: string): void {
    if (this.#closed) return
    this.#active = false
    this.#epoch++
    this.#clearTimers()
    try {
      this.#closeNtp()
    } catch {
      /* close() still releases the Wi-Fi adapter. */
    }
    try {
      this.#wifi.disconnect()
    } catch (error) {
      this.#recordCleanupError(error)
    }
    this.#transition({ type: 'failed' }, reason)
    if (!this.#closed) this.#emitError(reason)
  }

  #emitError(reason: string): void {
    try {
      this.#error(reason)
    } catch {
      trace('[network] error observer failed\n')
    }
  }
  #transition(event: Parameters<NetworkConnectionStateMachine['transition']>[0], reason?: string): NetworkState {
    const state = this.#stateMachine.transition(event)
    try {
      this.#options.onStateChanged?.(state, reason)
    } catch {
      trace('[network] state observer failed\n')
    }
    return state
  }
}
