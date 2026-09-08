import { CancellationSource } from 'cancellation'
import type { LocalPeerCapability, LocalPeerOpenOptions, LocalPeerSession } from 'local-peer-types'
import { NetworkConnectionState } from 'network-state'
import type {
  NetworkAvailability,
  NetworkConnection,
  NetworkReadyResult,
  NetworkState,
  StartNetworkConnectionOptions,
} from 'network-types'
import type { OperationClock } from 'operation-queue'
import { OwnedResources, ResourceScope } from 'owned-resources'
import { asStackchanError, finiteNumber, StackchanError } from 'stackchan/errors'
import type { CancellationSignal, TaskContext } from 'stackchan/task'
import { TaskScope } from 'task-scope'

export type HostBootServicesOptions = {
  credentials: { ssid: string; password: string }
  wifi?: {
    maxAttempts?: number
    retryDelayMs?: number
    attemptTimeoutMs?: number
  }
}
export type OwnedLocalPeer = LocalPeerCapability & { close(): void }
export type BootSessionDependencies = {
  clock: OperationClock
  networkAvailability: NetworkAvailability
  openNetwork(options: StartNetworkConnectionOptions): NetworkConnection
  createLocalPeer(): OwnedLocalPeer | undefined
  beforeStart?(): Promise<void>
  report?(message: string): void
}

/** A host owns the boot session; apps borrow its connectivity capabilities. */
export class BootSession {
  readonly #source = new CancellationSource()
  readonly #resources = new ResourceScope()
  readonly #tasks: TaskScope
  readonly #shutdown: OwnedResources
  readonly #dependencies: BootSessionDependencies
  readonly #options: HostBootServicesOptions
  readonly #startBarrier: Promise<void>
  #connection?: NetworkConnection
  #lastState: NetworkState = NetworkConnectionState.IDLE
  readonly connectivity: {
    network: {
      readonly ready: Promise<NetworkReadyResult>
      readonly availability: NetworkAvailability
      readonly state: NetworkState
    }
    localPeer?: LocalPeerCapability
  }

  constructor(options: HostBootServicesOptions, dependencies: BootSessionDependencies) {
    const maxAttempts = options.wifi?.maxAttempts ?? 3
    finiteNumber(maxAttempts, 'maxAttempts', 1, 10)
    if (!Number.isInteger(maxAttempts)) throw new StackchanError('INVALID_ARGUMENT', 'maxAttempts must be an integer')
    finiteNumber(options.wifi?.retryDelayMs ?? 500, 'retryDelayMs', 0, 60_000)
    finiteNumber(options.wifi?.attemptTimeoutMs ?? 15_000, 'attemptTimeoutMs', 1, 120_000)
    this.#options = { ...options, credentials: { ...options.credentials }, wifi: { ...options.wifi, maxAttempts } }
    this.#dependencies = dependencies
    this.#tasks = new TaskScope(dependencies.clock, 8)
    this.#shutdown = new OwnedResources([
      () => this.#source.cancel(new StackchanError('CLOSED', 'Host boot services closed')),
      () => this.#tasks.close(),
      () => this.#resources.close(),
    ])
    const localPeer = dependencies.createLocalPeer()
    if (localPeer) this.#resources.own(localPeer)
    // Replacement teardown runs even if this session is closed before its first task starts.
    this.#startBarrier = Promise.resolve().then(() => dependencies.beforeStart?.())
    void this.#startBarrier.catch(() => {})
    const owner = this
    this.connectivity = {
      localPeer: localPeer
        ? { id: localPeer.id, open: (options, signal) => this.#openPeer(localPeer, options, signal) }
        : undefined,
      network: {
        availability: dependencies.networkAvailability,
        get state() {
          return owner.closed ? NetworkConnectionState.CLOSED : (owner.#connection?.state ?? owner.#lastState)
        },
        ready: this.#tasks
          .run((task) => this.#run(task), this.signal)
          .catch((error) => {
            const failure = asStackchanError(error)
            return { status: 'failed', reason: failure.message, code: failure.code }
          }),
      },
    }
  }

  get closed(): boolean {
    return this.#shutdown.closed
  }
  get signal(): CancellationSignal {
    return this.#source.signal
  }
  close(): Promise<void> {
    return this.#shutdown.close()
  }

  async #run(task: TaskContext): Promise<NetworkReadyResult> {
    await this.#startBarrier
    task.signal.throwIfCancelled()
    if (this.#dependencies.networkAvailability === 'unavailable')
      return { status: 'skipped', reason: 'Wi-Fi is unavailable on this target' }
    if (!this.#options.credentials.ssid) return { status: 'skipped', reason: 'missing Wi-Fi credentials' }
    const options = this.#options.wifi ?? {}
    const maxAttempts = options.maxAttempts ?? 3
    let failure: NetworkReadyResult & { status: 'failed' } = {
      status: 'failed',
      reason: 'connection failed',
      code: 'IO',
    }
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      task.signal.throwIfCancelled()
      const result = await this.#attempt(task.signal)
      task.signal.throwIfCancelled()
      if (result.status !== 'failed') return result
      failure = result
      this.#report(`[network] boot Wi-Fi attempt ${attempt}/${maxAttempts} failed: ${result.reason}`)
      if (
        result.code === 'BUSY' ||
        result.code === 'CONFIG' ||
        result.code === 'INVALID_ARGUMENT' ||
        result.code === 'UNSUPPORTED'
      )
        return result
      if (attempt < maxAttempts) await task.sleep(options.retryDelayMs ?? 500)
    }
    return failure
  }

  async #attempt(signal: CancellationSignal): Promise<NetworkReadyResult> {
    let connection: NetworkConnection | undefined
    let release: (() => void) | undefined
    let cancelDeadline: (() => void) | undefined
    let unsubscribe: (() => void) | undefined
    let keep = false
    try {
      const result = await new Promise<NetworkReadyResult>((resolve, reject) => {
        let settled = false
        const finish = (result: NetworkReadyResult) => {
          if (settled) return
          settled = true
          resolve(result)
        }
        unsubscribe = signal.subscribe((reason) => {
          if (settled) return
          settled = true
          reject(reason)
        })
        if (settled) return
        cancelDeadline = this.#dependencies.clock.after(this.#options.wifi?.attemptTimeoutMs ?? 15_000, () =>
          finish({ status: 'failed', reason: 'connection timeout', code: 'TIMEOUT' }),
        )
        connection = this.#dependencies.openNetwork({
          ...this.#options.credentials,
          scanBeforeConnect: true,
          connectionTimeoutMs: this.#options.wifi?.attemptTimeoutMs ?? 15_000,
          onStateChanged: (state) => {
            if (!this.closed) this.#lastState = state
          },
          onConnected: () => finish({ status: 'connected' }),
          onError: (reason) =>
            finish({
              status: 'failed',
              reason: reason ?? 'connection failed',
              code: reason === 'connection timeout' ? 'TIMEOUT' : 'IO',
            }),
        })
        release = this.#resources.defer(() => connection?.close())
        this.#connection = connection
      })
      signal.throwIfCancelled()
      if (result.status === 'connected') {
        keep = true
        this.#connection = connection
      }
      return result
    } catch (error) {
      signal.throwIfCancelled()
      const failure = asStackchanError(error)
      return { status: 'failed', reason: failure.message, code: failure.code }
    } finally {
      cancelDeadline?.()
      unsubscribe?.()
      if (!keep) {
        if (this.#connection === connection) this.#connection = undefined
        // Retain failed cleanup for close() so replacement cannot hide it.
        connection?.close()
        release?.()
      }
    }
  }

  #report(message: string): void {
    try {
      this.#dependencies.report?.(message)
    } catch {
      /* Diagnostics do not own boot. */
    }
  }

  #openPeer(
    peer: OwnedLocalPeer,
    options: LocalPeerOpenOptions,
    parent?: CancellationSignal,
  ): Promise<LocalPeerSession> {
    return this.#tasks.run(async ({ signal }) => {
      await this.#startBarrier
      signal.throwIfCancelled()
      const session = await peer.open(options, signal)
      if (signal.reason) {
        session.close()
        signal.throwIfCancelled()
      }
      return session
    }, parent)
  }
}
