import { CancellationSource } from 'cancellation'
import { ResourceScope } from 'owned-resources'
import { asStackchanError, StackchanError } from 'stackchan/errors'
import type { AppStreamingAudio } from 'stackchan/extensions/audio'
import type { AppConversation } from 'stackchan/extensions/conversation'
import type { AppMaintenance } from 'stackchan/extensions/maintenance'
import type { AppNetwork, Connection } from 'stackchan/extensions/network'
import type { AppSensors } from 'stackchan/extensions/sensors'
import type { AppSettings } from 'stackchan/extensions/settings'
import type { CancellationSignal, TaskContext } from 'stackchan/task'

/** Host-only access to the existing AppSession task/resource owner. */
export interface AppServiceScope {
  call<T>(operation: () => T): T
  run<T>(operation: (task: TaskContext) => T | Promise<T>, signal?: CancellationSignal): Promise<T>
  own(close: () => void | Promise<void>): () => Promise<void>
  report(error: unknown): void
}

/** A connection's subscriptions and operations end together, before its device is released. */
export class AppConnection implements Connection {
  readonly #scope: AppServiceScope
  readonly #resources = new ResourceScope()
  readonly #source = new CancellationSource()
  readonly close: () => Promise<void>
  #closed = false

  constructor(scope: AppServiceScope) {
    this.#scope = scope
    const close = scope.own(async () => {
      this.#closed = true
      try {
        this.#source.cancel(new StackchanError('CLOSED', 'Connection closed'))
      } finally {
        await this.#resources.close()
      }
    })
    this.close = () => {
      this.#closed = true
      return close()
    }
  }
  get closed(): boolean {
    return this.#closed
  }
  call<T>(operation: () => T): T {
    return this.#scope.call(() => {
      if (this.#closed) throw new StackchanError('CLOSED', 'Connection closed')
      return operation()
    })
  }
  run<T>(operation: (task: TaskContext) => T | Promise<T>, signal?: CancellationSignal): Promise<T> {
    if (this.#closed) return Promise.reject(new StackchanError('CLOSED', 'Connection closed'))
    const parent = new CancellationSource()
    const remove = this.#source.signal.subscribe((error) => parent.cancel(error))
    const removeExternal = signal?.subscribe((error) => parent.cancel(error))
    const cleanup = () => {
      remove()
      removeExternal?.()
    }
    try {
      return this.#scope.run(operation, parent.signal).finally(cleanup)
    } catch (error) {
      cleanup()
      return Promise.reject(error)
    }
  }
  /** Register immediately; also releases devices whose asynchronous open finished late. */
  own(close: () => void | Promise<void>): () => void {
    if (this.#closed || this.#resources.size >= 64) {
      void Promise.resolve().then(close).catch(this.#scope.report)
      throw new StackchanError(
        this.#closed ? 'CLOSED' : 'BUSY',
        this.#closed ? 'Connection closed while opening' : 'Too many connection resources',
      )
    }
    return this.#resources.defer(close)
  }
  /** A subscription is released once, by its caller or by connection shutdown. */
  listen<Args extends unknown[]>(
    subscribe: (handler: (...args: Args) => void) => () => void,
    handler: (...args: Args) => void,
  ): () => void {
    return this.call(() => {
      if (typeof handler !== 'function') throw new StackchanError('INVALID_ARGUMENT', 'A subscription needs a function')
      let disposed = false
      const off = subscribe(
        this.event((...args: Args) => {
          if (!disposed) handler(...args)
        }),
      )
      const dispose = () => {
        if (disposed) return
        disposed = true
        off()
      }
      const release = this.own(dispose)
      return () => {
        release()
        dispose()
      }
    })
  }
  event<Args extends unknown[]>(handler: ((...args: Args) => void) | undefined): (...args: Args) => void {
    return (...args) => {
      if (this.#closed || !handler) return
      try {
        this.call(() => handler(...args))
      } catch (error) {
        this.#scope.report(asStackchanError(error))
      }
    }
  }
}

export type AppExtensions = {
  settings?: AppSettings
  network?: AppNetwork
  conversation?: AppConversation
  sensors?: AppSensors
  streamingAudio?: AppStreamingAudio
  maintenance?: AppMaintenance
}
