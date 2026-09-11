import { asStackchanError, finiteNumber, StackchanError } from 'stackchan/errors'
import Timer from 'timer'
import type { CameraCaptureOptions, CameraFrame, RobotCamera } from '../camera.js'

export type { CameraCaptureOptions, CameraFrame, CameraImageType, RobotCamera } from '../camera.js'

type CameraBridge = {
  availability?(): number
  start(width: number, height: number, browser: boolean): void | Promise<void>
  startStatus?(): number
  error?(): string
  stop(): void | Promise<void>
  capture(width: number, height: number): CameraFrame | undefined
}
type HostCamera = {
  availability?(): string
  start(options: CameraCaptureOptions & { useBrowserCamera: boolean }): void | Promise<void>
  stop(): void | Promise<void>
  capture(options: CameraCaptureOptions): CameraFrame | undefined
}
export type WasmCameraConstructorOptions = { useBrowserCamera?: boolean }
export type WasmCameraStartOptions = CameraCaptureOptions & WasmCameraConstructorOptions

type BridgeResource = { key: object; references: number; bridge: CameraBridge; owner?: Camera; fault?: Error }
// XS cannot add a WeakMap link to a preloaded, read-only native bridge. Remove
// successful entries explicitly when the final Camera closes instead.
const bridgeResources = new Map<object, BridgeResource>()

function resource(key: object, bridge: CameraBridge): BridgeResource {
  let entry = bridgeResources.get(key)
  if (!entry) {
    entry = { key, references: 0, bridge }
    bridgeResources.set(key, entry)
  }
  entry.references++
  return entry
}

function findBridge(): BridgeResource | undefined {
  const environment = globalThis as typeof globalThis & {
    __stackchanWasmCameraBridge?: CameraBridge
    Host?: { Camera?: HostCamera }
  }
  if (environment.__stackchanWasmCameraBridge)
    return resource(environment.__stackchanWasmCameraBridge, environment.__stackchanWasmCameraBridge)
  const host = environment.Host?.Camera
  if (!host) return undefined
  return resource(host, {
    availability: () => (host.availability?.() === 'unavailable' ? 0 : host.availability?.() === 'simulated' ? 1 : 2),
    start: (width, height, useBrowserCamera) => host.start({ width, height, imageType: 'rgb565le', useBrowserCamera }),
    stop: () => host.stop(),
    capture: (width, height) => host.capture({ width, height, imageType: 'rgb565le' }),
  })
}

/** Pins one host bridge and owns its stream, polls and pending starts. */
export default class Camera implements RobotCamera {
  readonly formats = ['rgb565le', 'rgb565be'] as const
  #resource = findBridge()
  #browser: boolean
  #closed = false
  #started = false
  #epoch = 0
  #cancel?: (error: unknown) => void
  #starting?: Promise<void>
  #stopping?: Promise<void>
  #closePromise?: Promise<void>
  constructor(options: WasmCameraConstructorOptions = {}) {
    this.#browser = options.useBrowserCamera ?? true
  }
  get availability(): 'native' | 'simulated' | 'unavailable' {
    if (!this.#resource) return 'unavailable'
    if (!this.#browser) return 'simulated'
    const status = this.#resource.bridge.availability?.() ?? 2
    return status === 0 ? 'unavailable' : status === 1 ? 'simulated' : 'native'
  }
  get available(): boolean {
    return this.availability !== 'unavailable'
  }
  async start(options: WasmCameraStartOptions = {}): Promise<void> {
    this.#assertUsable()
    const { width, height } = this.#request(options)
    if ((options.useBrowserCamera ?? this.#browser) && this.#resource?.bridge.availability?.() === 0)
      throw new StackchanError('UNSUPPORTED', 'Browser camera is unavailable')
    if (this.#starting || this.#cancel) throw new StackchanError('BUSY', 'Camera is busy')
    if (this.#stopping) await this.#stopping
    this.#assertUsable()
    if (this.#starting || this.#cancel) throw new StackchanError('BUSY', 'Camera is busy')
    const owned = this.#assertUsable()
    if (owned.owner && owned.owner !== this) throw new StackchanError('BUSY', 'Camera is in use')
    owned.owner = this
    this.#browser = options.useBrowserCamera ?? this.#browser
    const epoch = ++this.#epoch
    this.#started = false
    const bridge = owned.bridge
    let ready = false
    const starting = this.#wait(
      () => {
        const status = bridge.startStatus?.() ?? (ready ? 1 : 0)
        if (status < 0) throw new StackchanError('IO', bridge.error?.() || 'Browser camera failed to start')
        return status > 0 ? true : undefined
      },
      15_000,
      () =>
        Promise.resolve(bridge.start(width, height, this.#browser)).then(() => {
          ready = true
        }),
    ).then(() => {
      if (epoch !== this.#epoch) throw new StackchanError('CANCELLED', 'Camera start cancelled')
      this.#started = true
    })
    this.#starting = starting
    try {
      await starting
    } catch (error) {
      if (epoch === this.#epoch) await this.stop()
      throw asStackchanError(error)
    } finally {
      if (this.#starting === starting) this.#starting = undefined
    }
  }
  stop(): Promise<void> {
    if (this.#stopping) return this.#stopping
    this.#epoch++
    this.#started = false
    this.#cancel?.(new StackchanError(this.#closed ? 'CLOSED' : 'CANCELLED', 'Camera operation cancelled'))
    const owned = this.#resource
    if (!owned || owned.owner !== this) return owned?.fault ? Promise.reject(owned.fault) : Promise.resolve()
    const stopping = Promise.resolve()
      .then(() => owned.bridge.stop())
      .then(() => {
        if (owned.fault) throw owned.fault
      })
      .catch((error) => {
        owned.fault = asStackchanError(error)
        throw owned.fault
      })
      .finally(() => {
        if (owned.owner === this) owned.owner = undefined
        if (this.#stopping === stopping) this.#stopping = undefined
      })
    this.#stopping = stopping
    return stopping
  }
  close(): Promise<void> {
    if (!this.#closePromise) {
      this.#closed = true
      this.#closePromise = this.stop().finally(() => {
        const owned = this.#resource
        if (owned && --owned.references === 0 && !owned.fault) bridgeResources.delete(owned.key)
      })
    }
    return this.#closePromise
  }
  async capture(options: CameraCaptureOptions = {}): Promise<CameraFrame> {
    this.#assertUsable()
    const { width, height } = this.#request(options)
    if (!this.#started) await this.start(options)
    const owned = this.#assertUsable()
    if (!this.#started || owned.owner !== this) throw new StackchanError('CANCELLED', 'Camera was stopped')
    if (this.#cancel) throw new StackchanError('BUSY', 'Camera is capturing')
    const epoch = this.#epoch
    const frame = await this.#wait(() => owned.bridge.capture(width, height), 500)
    try {
      if (epoch !== this.#epoch) throw new StackchanError('CANCELLED', 'Camera capture cancelled')
      if (
        !Number.isInteger(frame.width) ||
        frame.width < 1 ||
        frame.width > 320 ||
        !Number.isInteger(frame.height) ||
        frame.height < 1 ||
        frame.height > 240 ||
        frame.imageType !== 'rgb565le' ||
        !(frame.buffer instanceof ArrayBuffer) ||
        frame.buffer.byteLength !== frame.width * frame.height * 2 ||
        (frame.source !== undefined && frame.source !== 'native' && frame.source !== 'simulated')
      )
        throw new StackchanError('IO', 'Browser camera returned an invalid image')
      const buffer = frame.buffer.slice(0)
      if (options.imageType === 'rgb565be') {
        const bytes = new Uint8Array(buffer)
        for (let i = 0; i < bytes.length; i += 2) {
          const first = bytes[i]
          bytes[i] = bytes[i + 1]
          bytes[i + 1] = first
        }
      }
      return {
        width: frame.width,
        height: frame.height,
        imageType: options.imageType ?? 'rgb565le',
        source: frame.source ?? (this.#browser ? 'native' : 'simulated'),
        buffer,
      }
    } finally {
      this.#releaseFrame(frame, owned)
    }
  }
  #releaseFrame(frame: CameraFrame, owned: BridgeResource): void {
    try {
      frame.close?.()
    } catch (error) {
      owned.fault = asStackchanError(error)
      throw owned.fault
    }
  }
  #assertUsable(): BridgeResource {
    if (this.#closed) throw new StackchanError('CLOSED', 'Camera is closed')
    if (!this.#resource) throw new StackchanError('UNSUPPORTED', 'Camera bridge is unavailable')
    if (this.#resource.fault) throw this.#resource.fault
    return this.#resource
  }
  #wait<T>(read: () => T | undefined, timeoutMs: number, begin?: () => Promise<void>): Promise<T> {
    return new Promise((resolve, reject) => {
      let settled = false
      let pollTimer: ReturnType<typeof Timer.set> | undefined
      let deadline: ReturnType<typeof Timer.set> | undefined
      const finish = (result: { value: T } | { error: unknown }) => {
        if (settled) return
        settled = true
        if (pollTimer !== undefined) Timer.clear(pollTimer)
        if (deadline !== undefined) Timer.clear(deadline)
        if (this.#cancel === cancel) this.#cancel = undefined
        if ('error' in result) reject(asStackchanError(result.error))
        else resolve(result.value)
      }
      const cancel = (error: unknown) => finish({ error })
      this.#cancel = cancel
      const poll = () => {
        pollTimer = undefined
        if (settled) return
        try {
          const value = read()
          if (value !== undefined) finish({ value })
          else pollTimer = Timer.set(poll, 20)
        } catch (error) {
          finish({ error: asStackchanError(error) })
        }
      }
      try {
        deadline = Timer.set(() => cancel(new StackchanError('TIMEOUT', 'Camera operation timed out')), timeoutMs)
        if (begin) void begin().catch((error) => cancel(asStackchanError(error)))
        poll()
      } catch (error) {
        cancel(asStackchanError(error))
      }
    })
  }
  #request(options: CameraCaptureOptions) {
    const width = options.width ?? 176,
      height = options.height ?? 144
    finiteNumber(width, 'width', 1, 320)
    finiteNumber(height, 'height', 1, 240)
    if (!Number.isInteger(width) || !Number.isInteger(height))
      throw new StackchanError('INVALID_ARGUMENT', 'Image dimensions must be integers')
    if (options.imageType && !this.formats.includes(options.imageType as 'rgb565le'))
      throw new StackchanError('UNSUPPORTED', 'Browser camera supports RGB565 images')
    return { width, height }
  }
}
