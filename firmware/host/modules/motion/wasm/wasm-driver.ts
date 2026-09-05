import { directMotionPort, type MotionPort, motionInfo } from 'motion-port'

type Rotation = { y: number; p: number; r: number }
type Maybe<T> = { success: true; value: T } | { success: false; reason?: string }
type MotionCompletion = (error?: unknown) => void
type MotionResultCallback<T> = (result: T) => void
type MotionDurationSeconds = number

type HostDriverBridge = {
  applyRotation?: (message: { rotation: Rotation; time?: number }) => void
  setTorque?: (torque: boolean) => void
  getRotation?: () => Rotation | undefined
}

type HostAudioOutBridge = {
  tone?: (message: { hz: number; duration: number; volume?: number }) => void | Promise<void>
  play?: (buffer: ArrayBuffer) => boolean | Promise<boolean>
  close?: () => void
}

type HostAudioInBridge = {
  record?: (durationMilliSec: number) => ArrayBuffer | Promise<ArrayBuffer>
  close?: () => void
}

type WasmHost = {
  Driver?: HostDriverBridge
  AudioOut?: HostAudioOutBridge
  AudioIn?: HostAudioInBridge
}

declare global {
  // Browser-side simulator code may install this before the Moddable WASM app starts.
  var Host: WasmHost | undefined
  var __stackchanWasmMotionBridge:
    | {
        available(): boolean
        write(y: number, p: number, r: number, seconds: number): boolean
        torque(enabled: boolean): boolean
      }
    | undefined
}

const ZERO_ROTATION: Rotation = { y: 0, p: 0, r: 0 }

function copyRotation(from: Rotation, to: Rotation): void {
  to.y = from.y
  to.p = from.p
  to.r = from.r
}

function assertValidRotation(rotation: Rotation): void {
  if (!Number.isFinite(rotation.y) || !Number.isFinite(rotation.p) || !Number.isFinite(rotation.r)) {
    throw new TypeError('Invalid rotation: y, p, and r must be finite numbers')
  }
}

export class WasmDriver {
  readonly motion: MotionPort
  #closed = false
  #rotation: Rotation = { y: ZERO_ROTATION.y, p: ZERO_ROTATION.p, r: ZERO_ROTATION.r }
  #rotationResult: Maybe<Rotation> = { success: true, value: this.#rotation }
  #closedResult: Maybe<Rotation> = { success: false, reason: 'Simulator motion driver is closed' }

  constructor(_options?: unknown) {
    void _options
    this.motion = directMotionPort(
      this,
      this.#available()
        ? motionInfo('estimated', [-150, 150], [-90, 90], true, 'simulated')
        : { availability: 'unavailable', reason: 'Simulator motion bridge is unavailable' },
      16,
    )
  }

  applyRotation(rotation: Rotation, time?: MotionDurationSeconds, callback?: MotionCompletion): void {
    try {
      if (this.#closed) throw new Error('Simulator motion driver is closed')
      assertValidRotation(rotation)
      if (time !== undefined && (!Number.isFinite(time) || time < 0)) throw new Error('Invalid motion duration')
      const bridge = globalThis.__stackchanWasmMotionBridge
      if (bridge) {
        if (!bridge.write(rotation.y, rotation.p, rotation.r, time ?? 0))
          throw new Error('Simulator motion write failed')
      } else {
        const write = globalThis.Host?.Driver?.applyRotation
        if (!write) throw new Error('Simulator motion bridge is unavailable')
        write.call(globalThis.Host.Driver, { rotation, time })
      }
      copyRotation(rotation, this.#rotation)
      callback?.()
    } catch (error) {
      if (callback) callback(error)
      else throw error
    }
  }

  getRotation(callback: MotionResultCallback<Maybe<Rotation>>): void {
    if (this.#closed) {
      callback(this.#closedResult)
      return
    }
    const rotation = globalThis.Host?.Driver?.getRotation?.() ?? this.#rotation
    copyRotation(rotation, this.#rotation)
    callback(this.#rotationResult)
  }

  setTorque(torque: boolean, callback?: MotionCompletion): void {
    try {
      if (this.#closed) throw new Error('Simulator motion driver is closed')
      const bridge = globalThis.__stackchanWasmMotionBridge
      if (bridge) {
        if (!bridge.torque(torque)) throw new Error('Simulator torque write failed')
      } else {
        const write = globalThis.Host?.Driver?.setTorque
        if (!write) throw new Error('Simulator motion bridge is unavailable')
        write.call(globalThis.Host.Driver, torque)
      }
      callback?.()
    } catch (error) {
      if (callback) callback(error)
      else throw error
    }
  }

  close(): void {
    this.#closed = true
  }

  #available(): boolean {
    if (globalThis.__stackchanWasmMotionBridge) return globalThis.__stackchanWasmMotionBridge.available()
    return !!(globalThis.Host?.Driver?.applyRotation && globalThis.Host.Driver.setTorque)
  }
}

export const DynamixelDriver = WasmDriver
export const M5StackChanServoDriver = WasmDriver
export const NoneDriver = WasmDriver
export const PWMServoDriver = WasmDriver
export const RS30XDriver = WasmDriver
export const SCServoDriver = WasmDriver
