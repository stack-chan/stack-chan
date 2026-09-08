import type { AppExtensions, AppServiceScope } from 'app-service-scope'
import { CancellationSource } from 'cancellation'
import type { OperationClock } from 'operation-queue'
import { ResourceScope } from 'owned-resources'
import type { AppContext, AppDefinition } from 'stackchan/app'
import { asStackchanError, finiteNumber, StackchanError } from 'stackchan/errors'
import type { AppInput, ButtonName, HeadTouchEvent, MotionEvent } from 'stackchan/extensions/input'
import type { AppLighting } from 'stackchan/extensions/lighting'
import type { PiuAppDefinition, ScreenContext, ScreenDefinition } from 'stackchan/extensions/piu'
import type { AppUI, ChangeHandler, MenuControl, MenuLabel, MenuOption } from 'stackchan/extensions/ui'
import type { CancellationSignal, TaskContext, TaskHandler } from 'stackchan/task'
import { TaskScope } from 'task-scope'

export type AppPorts = Pick<AppContext, 'face' | 'ui' | 'capabilities'> & {
  extensions?(scope: AppServiceScope): AppExtensions
  controls?: Pick<
    AppUI,
    'faceStyle' | 'closeMenu' | 'setFaceStyle' | 'setImageAvatar' | 'setHandAnimation' | 'setEmoticon' | 'localize'
  > &
    Partial<Pick<AppUI, 'setTracking' | 'setMusicNotes' | 'setFaceMotionEnabled'>> & {
      registerMenu(view: AppMenuView, onSelect: (value?: string) => void): MenuControl<string | boolean>
      resetAppearance(): void | Promise<void>
    }
  audio: AppContext['audio'] & { close(): Promise<void> }
  motion: AppContext['motion'] & { close(): Promise<void> }
  camera: AppContext['camera'] & { close(): Promise<void> }
  input: {
    subscribePress(handler: () => void, name?: ButtonName): () => void
    subscribeHeadTouch?(handler: (event: HeadTouchEvent) => void): () => void
    subscribeMotion?(handler: (event: MotionEvent) => void): () => void
  }
  lighting?: AppLighting
  registerScreen?(
    definition: Omit<ScreenDefinition, 'create'> & {
      create(viewport: Omit<ScreenContext, 'app'>): ReturnType<ScreenDefinition['create']>
    },
  ): () => void
}
export type AppMenuView = MenuLabel & {
  kind: 'action' | 'choice' | 'swatch' | 'toggle'
  value?: string | boolean
  options?: readonly MenuOption[]
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
  #menuIds = new Set<string>()
  #ownsAppearance = false
  #ownedLights = new Set<string>()

  constructor(ports: AppPorts, clock: OperationClock, onError: (error: unknown) => void) {
    this.#ports = ports
    this.#tasks = new TaskScope(clock)
    this.#onError = onError
    const owner = this
    this.context = Object.freeze({
      ...ports.extensions?.({
        call: (operation) => this.#call(operation),
        run: (operation, signal) => this.#run(operation, signal),
        own: (close) => this.#ownService(close),
        report: (error) => this.#report(error),
      }),
      face: Object.freeze({
        setEmotion: (emotion) => {
          this.#assertOpen()
          if (ports.controls) this.#appearance()
          ports.face.setEmotion(emotion)
        },
        setMouthOpen: (value) => {
          this.#assertOpen()
          finiteNumber(value, 'mouth openness', 0, 1)
          if (ports.controls) this.#appearance()
          ports.face.setMouthOpen(value)
        },
        setColor: (part, color) => {
          this.#assertOpen()
          for (const key of ['r', 'g', 'b'] as const) finiteNumber(color?.[key], key, 0, 255)
          if (ports.controls) this.#appearance()
          ports.face.setColor(part, color)
        },
      }),
      audio: Object.freeze({
        say: (text, options) =>
          this.#run(({ signal }) => ports.audio.say(text, { ...options, signal }), options?.signal),
        playClip: (name, options) =>
          this.#run(({ signal }) => ports.audio.playClip(name, { ...options, signal }), options?.signal),
        tone: (hz, options) => this.#run(({ signal }) => ports.audio.tone(hz, { ...options, signal }), options?.signal),
        record: (options) => this.#run(({ signal }) => ports.audio.record({ ...options, signal }), options?.signal),
        play: (audio, options) =>
          this.#run(({ signal }) => ports.audio.play(audio, { ...options, signal }), options?.signal),
      }),
      motion: Object.freeze({
        get position() {
          return ports.motion.position
        },
        get info() {
          return ports.motion.info
        },
        move: (target, options) =>
          this.#run(({ signal }) => ports.motion.move(target, { ...options, signal }), options?.signal),
        lookAt: (target) => {
          this.#assertOpen()
          ports.motion.lookAt(target)
        },
        lookAway: () => {
          this.#assertOpen()
          ports.motion.lookAway()
        },
        stop: () => this.#run(() => ports.motion.stop()),
        relax: () => this.#run(() => ports.motion.relax()),
      }),
      camera: Object.freeze({
        get info() {
          return ports.camera.info
        },
        capture: (options) => this.#run(({ signal }) => ports.camera.capture({ ...options, signal }), options?.signal),
      }),
      input: Object.freeze({
        onPress: (name, handler) => {
          this.#assertOpen()
          if (!['primary', 'secondary', 'tertiary'].includes(name))
            throw new StackchanError('INVALID_ARGUMENT', 'Unknown input name')
          this.#checkHandler(handler)
          return this.#listen((run) => ports.input.subscribePress(() => run(handler), name))
        },
        onHeadTouch: (handler) => {
          this.#assertOpen()
          const subscribe = ports.input.subscribeHeadTouch
          this.#checkHandler(handler)
          if (!subscribe) throw new StackchanError('UNSUPPORTED', 'Head touch is unavailable')
          return this.#listen((run) => subscribe((event) => run((task) => handler(event, task))))
        },
        onMotion: (handler) => {
          this.#assertOpen()
          const subscribe = ports.input.subscribeMotion
          this.#checkHandler(handler)
          if (!subscribe) throw new StackchanError('UNSUPPORTED', 'Motion input is unavailable')
          return this.#listen((run) => subscribe((event) => run((task) => handler(event, task))))
        },
      } satisfies AppInput),
      lighting: Object.freeze({
        get names() {
          return ports.lighting?.names ?? Object.freeze([])
        },
        color: (name, color) => {
          this.#call(() => {
            for (const key of ['r', 'g', 'b'] as const) finiteNumber(color?.[key], key, 0, 255)
            this.#light(name).color(name, color)
          })
        },
        blink: (name, color, options) => {
          this.#call(() => {
            for (const key of ['r', 'g', 'b'] as const) finiteNumber(color?.[key], key, 0, 255)
            finiteNumber(options?.periodMs, 'periodMs', 100, 86_400_000)
            this.#light(name).blink(name, color, options)
          })
        },
        rainbow: (name) => this.#call(() => this.#light(name).rainbow(name)),
        off: (name) => this.#call(() => this.#light(name).off(name)),
      } satisfies AppLighting),
      time: Object.freeze({
        sleep: (ms) => this.#run((task) => task.sleep(ms)),
        after: (ms, handler) => this.#timer(ms, handler, false),
        every: (ms, handler) => this.#timer(ms, handler, true),
      }),
      ui: Object.freeze({
        get faceStyle() {
          return owner.#controls().faceStyle
        },
        addAction: (options, handler) => this.#addAction(options, handler),
        addChoice: (options, handler) => this.#addControl(options, handler),
        addToggle: (options, handler) => this.#addControl(options, handler),
        closeMenu: () => this.#call(() => this.#controls().closeMenu()),
        setFaceStyle: (style) => this.#call(() => this.#appearance().setFaceStyle(style)),
        setImageAvatar: (pack) => this.#call(() => this.#appearance().setImageAvatar(pack)),
        setHandAnimation: (animation) => this.#call(() => this.#appearance().setHandAnimation(animation)),
        setEmoticon: (emoticon) => this.#call(() => this.#appearance().setEmoticon(emoticon)),
        localize: (key, parameters) => this.#call(() => this.#controls().localize(key, parameters)),
        showBalloon: (text) => {
          this.#assertOpen()
          ports.ui.showBalloon(text)
        },
        hideBalloon: () => {
          this.#assertOpen()
          ports.ui.hideBalloon()
        },
        showImage: (image) => {
          this.#assertOpen()
          ports.ui.showImage(image)
        },
        hideImage: () => {
          this.#assertOpen()
          ports.ui.hideImage()
        },
        setTracking: (value) =>
          this.#call(() => {
            this.#appearance()
            if (!ports.controls?.setTracking) throw new StackchanError('UNSUPPORTED', 'Face tracking is unavailable')
            ports.controls.setTracking(value)
          }),
        setMusicNotes: (enabled) =>
          this.#call(() => {
            this.#appearance()
            if (!ports.controls?.setMusicNotes) throw new StackchanError('UNSUPPORTED', 'Music notes are unavailable')
            ports.controls.setMusicNotes(enabled)
          }),
        setFaceMotionEnabled: (enabled) =>
          this.#call(() => {
            this.#appearance()
            if (!ports.controls?.setFaceMotionEnabled)
              throw new StackchanError('UNSUPPORTED', 'Face motion controls are unavailable')
            ports.controls.setFaceMotionEnabled(enabled)
          }),
      } satisfies AppUI),
      capabilities: Object.freeze({ get: (id) => ports.capabilities.get(id) }),
    } satisfies AppContext & { lighting: AppLighting })
  }

  #ownService(dispose: () => void | Promise<void>): () => Promise<void> {
    try {
      this.#assertRegistrationAvailable()
    } catch (error) {
      void Promise.resolve()
        .then(dispose)
        .catch((failure) => this.#report(failure))
      throw error
    }
    let closed: Promise<void> | undefined
    const close = () => {
      if (!closed) closed = Promise.resolve().then(dispose).finally(release)
      return closed
    }
    const release = this.#resources.defer(close)
    return close
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
    this.#startPromise = Promise.resolve().then(() => this.#start(definition))
    return this.#startPromise
  }

  async #start(definition: AppDefinition): Promise<void> {
    try {
      this.#assertOpen()
      await this.#run(async () => {
        const screens = (definition as Partial<PiuAppDefinition>).screens
        if (screens !== undefined) {
          if (!Array.isArray(screens) || screens.length > 16)
            throw new StackchanError('INVALID_ARGUMENT', 'An app can register up to 16 screens')
          const register = this.#ports.registerScreen
          if (!register) throw new StackchanError('UNSUPPORTED', 'Piu screens are unavailable')
          for (const screen of screens) {
            this.#assertOpen()
            if (!screen || typeof screen.create !== 'function')
              throw new StackchanError('INVALID_ARGUMENT', 'A screen needs a create function')
            const create = screen.create
            const remove = register({
              ...screen,
              create: (viewport) => {
                this.#assertOpen()
                return create(Object.freeze({ ...viewport, app: this.context }))
              },
            })
            if (this.#resources.closed) remove()
            else this.#resources.defer(remove)
          }
        }
        this.#assertOpen()
        const dispose = await definition.setup(this.context)
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
        () => this.#ports.ui.hideImage(),
        () => this.#ports.camera.close(),
        () => this.#ports.motion.close(),
        () => this.#ports.audio.close(),
        () => this.#resources.close(),
        () => this.#tasks.close(),
      ])
      // Publish before invoking cancellation callbacks or user disposers.
      this.#closePromise = Promise.resolve()
        .then(() => cleanup.close())
        .finally(() => {
          this.#state = 'closed'
          this.#ownedLights.clear()
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

  #call<T>(operation: () => T): T {
    this.#assertOpen()
    try {
      return operation()
    } catch (error) {
      throw asStackchanError(error)
    }
  }

  #checkHandler(handler: unknown): void {
    if (typeof handler !== 'function') throw new StackchanError('INVALID_ARGUMENT', 'A function is required')
  }

  #listen(subscribe: (run: (handler: TaskHandler) => void) => () => void): () => void {
    this.#assertRegistrationAvailable()
    const source = new CancellationSource()
    let busy = false
    let disposed = false
    const unsubscribe = this.#call(() =>
      subscribe((handler) => {
        if (busy || disposed || this.#state === 'closing' || this.#state === 'closed') return
        busy = true
        void this.#run(handler, source.signal)
          .catch((error) => this.#report(error))
          .finally(() => {
            busy = false
          })
      }),
    )
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

  #controls(): NonNullable<AppPorts['controls']> {
    this.#assertOpen()
    if (!this.#ports.controls) throw new StackchanError('UNSUPPORTED', 'UI controls are unavailable')
    return this.#ports.controls
  }

  #light(name: string): AppLighting {
    this.#assertOpen()
    const lighting = this.#ports.lighting
    if (!lighting?.names.length) throw new StackchanError('UNSUPPORTED', 'Lighting is unavailable')
    if (!lighting.names.includes(name)) throw new StackchanError('INVALID_ARGUMENT', 'Unknown light')
    if (!this.#ownedLights.has(name)) {
      this.#assertRegistrationAvailable()
      this.#resources.defer(() => lighting.off(name))
      this.#ownedLights.add(name)
    }
    return lighting
  }

  #appearance(): NonNullable<AppPorts['controls']> {
    const controls = this.#controls()
    if (!this.#ownsAppearance) {
      this.#assertRegistrationAvailable()
      this.#resources.defer(() => controls.resetAppearance())
      this.#ownsAppearance = true
    }
    return controls
  }

  #checkMenu(options: MenuLabel): void {
    this.#assertRegistrationAvailable()
    if (
      !options ||
      typeof options.id !== 'string' ||
      options.id.length > 64 ||
      !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(options.id) ||
      typeof options.label !== 'string' ||
      !options.label.trim() ||
      options.label.length > 160 ||
      this.#menuIds.has(options.id)
    )
      throw new StackchanError('INVALID_ARGUMENT', 'A menu item needs a unique id and label')
  }

  #addAction(options: MenuLabel, handler: TaskHandler): () => void {
    this.#checkMenu(options)
    options = { ...options }
    if (typeof handler !== 'function') throw new StackchanError('INVALID_ARGUMENT', 'A menu item needs a handler')
    const controls = this.#controls()
    return this.#listen((run) => {
      const item = controls.registerMenu({ ...options, kind: 'action' }, () => run(handler))
      this.#menuIds.add(options.id)
      return () => {
        this.#menuIds.delete(options.id)
        item.close()
      }
    })
  }

  #addControl<Value extends string | boolean>(
    options: MenuLabel & { value: Value; options?: readonly MenuOption[] },
    handler: ChangeHandler<Value>,
  ): MenuControl<Value> {
    this.#checkMenu(options)
    let choices = options.options
    const valid = (value: unknown): value is Value =>
      choices
        ? typeof value === 'string' && choices.some((option) => option.value === value)
        : typeof value === 'boolean'
    if (
      typeof handler !== 'function' ||
      (choices !== undefined &&
        (!Array.isArray(choices) ||
          !choices.length ||
          choices.length > 32 ||
          choices.some(
            (option) =>
              !option ||
              typeof option.value !== 'string' ||
              !option.value ||
              option.value.length > 80 ||
              typeof option.label !== 'string' ||
              !option.label ||
              option.label.length > 160 ||
              (option.color !== undefined && !/^#[0-9a-f]{6}$/i.test(option.color)),
          ) ||
          new Set(choices.map((option) => option.value)).size !== choices.length)) ||
      !valid(options.value)
    )
      throw new StackchanError('INVALID_ARGUMENT', 'Invalid menu choices or value')
    choices = choices?.map((option) => Object.freeze({ ...option }))
    options = { ...options, options: choices }
    const controls = this.#controls()
    let value = options.value
    let revision = 0
    let closed = false
    let item: MenuControl<string | boolean>
    const setValue = (next: Value) => {
      this.#assertOpen()
      if (closed) throw new StackchanError('CLOSED', 'Menu item is closed')
      if (!valid(next)) throw new StackchanError('INVALID_ARGUMENT', 'Unknown menu value')
      this.#call(() => item.setValue(next))
      value = next
      revision++
    }
    const close = this.#listen((run) => {
      item = controls.registerMenu(
        {
          ...options,
          options: choices?.map((option) => Object.freeze({ ...option })),
          kind: choices ? (choices.some((option) => option.color) ? 'swatch' : 'choice') : 'toggle',
        },
        (selected) => {
          const next = choices ? selected : !value
          if (!valid(next)) return
          run(async (task) => {
            const previousRevision = revision
            try {
              await handler(next, task)
              task.signal.throwIfCancelled()
              if (previousRevision === revision) setValue(next)
            } catch (error) {
              if (!closed && this.#state !== 'closing' && this.#state !== 'closed') item.setValue(value)
              throw error
            }
          })
        },
      )
      this.#menuIds.add(options.id)
      return () => {
        closed = true
        this.#menuIds.delete(options.id)
        item.close()
      }
    })
    return Object.freeze({ setValue, close })
  }

  #timer(intervalMs: number, handler: TaskHandler, repeat: boolean): () => void {
    this.#assertRegistrationAvailable()
    this.#checkHandler(handler)
    finiteNumber(intervalMs, 'durationMs', repeat ? 1 : 0, 86_400_000)
    const source = new CancellationSource()
    const relinquish = this.#resources.defer(() => source.cancel())
    void this.#run(async (task) => {
      for (;;) {
        await task.sleep(intervalMs)
        task.signal.throwIfCancelled()
        try {
          await handler(task)
        } catch (error) {
          task.signal.throwIfCancelled()
          this.#report(error)
        }
        if (!repeat) return
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
