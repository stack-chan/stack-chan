import { CancellationSource } from 'cancellation'
import type { OperationClock } from 'operation-queue'
import { ResourceScope } from 'owned-resources'
import type { AppContext, AppDefinition, AppSetup } from 'stackchan/app'
import { finiteNumber, StackchanError } from 'stackchan/errors'
import type { CancellationSignal, TaskContext, TaskHandler } from 'stackchan/task'
import { TaskScope } from 'task-scope'

export type AppPorts = Pick<AppContext, 'face' | 'audio' | 'ui' | 'capabilities'> & {
  input: { subscribePress(handler: () => void): () => void }
}
export type AppSessionState = 'created' | 'starting' | 'running' | 'closing' | 'closed'

/** Owns app registrations and commands; board IO remains owned by the host. */
export class AppSession {
  readonly #resources = new ResourceScope()
  readonly #tasks: TaskScope
  readonly #ports: AppPorts
  readonly #onError: (error: unknown) => void
  readonly context: AppContext
  #state: AppSessionState = 'created'
  #startPromise: Promise<void> | undefined
  #closePromise: Promise<void> | undefined

  constructor(ports: AppPorts, clock: OperationClock, onError: (error: unknown) => void) {
    this.#ports = ports
    this.#tasks = new TaskScope(clock)
    this.#onError = onError
    this.context = Object.freeze({
      face: Object.freeze({
        setEmotion: (emotion) => {
          this.#assertOpen()
          ports.face.setEmotion(emotion)
        },
        setMouthOpen: (value) => {
          this.#assertOpen()
          finiteNumber(value, 'mouth openness', 0, 1)
          ports.face.setMouthOpen(value)
        },
        setColor: (part, color) => {
          this.#assertOpen()
          for (const key of ['r', 'g', 'b'] as const) finiteNumber(color[key], key, 0, 255)
          ports.face.setColor(part, color)
        },
      }),
      audio: Object.freeze({
        say: (text, options) =>
          this.#run(({ signal }) => ports.audio.say(text, { ...options, signal }), options?.signal),
        playClip: (name, options) =>
          this.#run(({ signal }) => ports.audio.playClip(name, { ...options, signal }), options?.signal),
        tone: (hz, options) => this.#run(({ signal }) => ports.audio.tone(hz, { ...options, signal }), options?.signal),
      }),
      input: Object.freeze({
        onPress: (name, handler) => {
          this.#assertOpen()
          if (name !== 'primary') throw new StackchanError('INVALID_ARGUMENT', 'Unknown input name')
          return this.#listen(handler)
        },
      }),
      time: Object.freeze({
        sleep: (ms) => this.#run((task) => task.sleep(ms)),
        every: (ms, handler) => this.#every(ms, handler),
      }),
      ui: Object.freeze({
        showBalloon: (text) => {
          this.#assertOpen()
          ports.ui.showBalloon(text)
        },
        hideBalloon: () => {
          this.#assertOpen()
          ports.ui.hideBalloon()
        },
      }),
      capabilities: Object.freeze({ get: (id) => ports.capabilities.get(id) }),
    } satisfies AppContext)
  }

  get state(): AppSessionState {
    return this.#state
  }
  get resourceCount(): number {
    return this.#resources.size
  }
  get taskCount(): number {
    return this.#tasks.size
  }

  start(definition: AppDefinition): Promise<void> {
    if (this.#state === 'closing' || this.#state === 'closed')
      return Promise.reject(new StackchanError('CLOSED', 'App is closed'))
    if (this.#startPromise) return this.#startPromise
    if (this.#state !== 'created') return Promise.reject(new StackchanError('CLOSED', 'App is closed'))
    if (definition.apiVersion !== 2)
      return Promise.reject(new StackchanError('UNSUPPORTED', 'Unsupported app API version'))
    this.#state = 'starting'
    // Defer setup until startPromise is visible to reentrant callers.
    this.#startPromise = Promise.resolve().then(() => this.#start(definition.setup))
    return this.#startPromise
  }

  async #start(setup: AppSetup): Promise<void> {
    try {
      this.#assertOpen()
      await this.#run(async () => {
        const dispose = await setup(this.context)
        if (typeof dispose === 'function') {
          if (this.#resources.closed) {
            try {
              dispose()
            } catch (error) {
              this.#report(error)
            }
          } else this.#resources.defer(dispose)
        }
      })
      this.#assertOpen()
      this.#state = 'running'
    } catch (error) {
      try {
        await this.close()
      } catch (closeError) {
        this.#report(closeError)
      }
      throw error
    }
  }

  close(): Promise<void> {
    if (!this.#closePromise) {
      this.#state = 'closing'
      const cleanup = new ResourceScope([
        () => this.#ports.ui.hideBalloon(),
        () => this.#resources.close(),
        () => this.#tasks.close(),
      ])
      // Publish before invoking cancellation callbacks or user disposers.
      this.#closePromise = Promise.resolve()
        .then(() => cleanup.close())
        .finally(() => {
          this.#state = 'closed'
        })
    }
    return this.#closePromise
  }

  #assertOpen(): void {
    if (this.#state === 'closing' || this.#state === 'closed') throw new StackchanError('CLOSED', 'App is closed')
  }

  #run<T>(handler: (task: TaskContext) => T | Promise<T>, signal?: CancellationSignal): Promise<T> {
    try {
      this.#assertOpen()
    } catch (error) {
      return Promise.reject(error)
    }
    return this.#tasks.run((task) => {
      this.#assertOpen()
      return handler(task)
    }, signal)
  }

  #listen(handler: TaskHandler): () => void {
    this.#assertRegistrationAvailable()
    const source = new CancellationSource()
    let busy = false
    let disposed = false
    const unsubscribe = this.#ports.input.subscribePress(() => {
      if (busy || disposed || this.#state === 'closing' || this.#state === 'closed') return
      busy = true
      void this.#run(handler, source.signal)
        .catch((error) => this.#report(error))
        .finally(() => {
          busy = false
        })
    })
    const relinquish = this.#resources.defer(() => {
      disposed = true
      try {
        unsubscribe()
      } finally {
        source.cancel()
      }
    })
    return () => {
      if (disposed) return
      disposed = true
      relinquish()
      try {
        unsubscribe()
      } finally {
        source.cancel()
      }
    }
  }

  #every(intervalMs: number, handler: TaskHandler): () => void {
    this.#assertRegistrationAvailable()
    finiteNumber(intervalMs, 'intervalMs', 1, 86_400_000)
    const source = new CancellationSource()
    const relinquish = this.#resources.defer(() => source.cancel())
    void this.#run(async (task) => {
      for (;;) {
        await task.sleep(intervalMs)
        task.signal.throwIfCancelled()
        await handler(task)
      }
    }, source.signal)
      .catch((error) => this.#report(error))
      .finally(relinquish)
    return () => {
      relinquish()
      source.cancel()
    }
  }

  #report(error: unknown): void {
    if (error instanceof StackchanError && (error.code === 'CLOSED' || error.code === 'CANCELLED')) return
    try {
      this.#onError(error)
    } catch {
      /* Error observers cannot keep the session alive. */
    }
  }

  #assertRegistrationAvailable(): void {
    this.#assertOpen()
    if (this.#resources.size >= 64) throw new StackchanError('BUSY', 'Too many app registrations')
  }
}
