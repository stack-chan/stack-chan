type Rotation = { y: number; p: number; r: number }
type Maybe<T> = { success: true; value: T } | { success: false; error?: string }

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
}

const ZERO_ROTATION: Rotation = { y: 0, p: 0, r: 0 }
const writeTrace = (message: string) =>
  (globalThis as unknown as { trace?: (message: string) => void }).trace?.(message)

function assertValidRotation(rotation: Rotation): void {
  if (!Number.isFinite(rotation.y) || !Number.isFinite(rotation.p) || !Number.isFinite(rotation.r)) {
    throw new TypeError('Invalid rotation: y, p, and r must be finite numbers')
  }
}

export class WasmDriver {
  #rotation: Rotation = { ...ZERO_ROTATION }

  constructor(_options?: unknown) {
    void _options
  }

  async applyRotation(rotation: Rotation, time?: number): Promise<void> {
    assertValidRotation(rotation)
    this.#rotation = { ...rotation }
    writeTrace(
      `[WasmDriver] applyRotation y=${rotation.y} p=${rotation.p} r=${rotation.r} time=${time === undefined ? '' : time}\n`,
    )
    globalThis.Host?.Driver?.applyRotation?.({ rotation, time })
    return Promise.resolve()
  }

  getRotation(): Promise<Maybe<Rotation>> {
    const rotation = globalThis.Host?.Driver?.getRotation?.() ?? this.#rotation
    return Promise.resolve({ success: true, value: { ...rotation } })
  }

  setTorque(torque: boolean): Promise<void> {
    writeTrace(`[WasmDriver] setTorque torque=${torque ? 1 : 0}\n`)
    globalThis.Host?.Driver?.setTorque?.(torque)
    return Promise.resolve()
  }
}

export const DynamixelDriver = WasmDriver
export const M5StackChanServoDriver = WasmDriver
export const NoneDriver = WasmDriver
export const PWMServoDriver = WasmDriver
export const RS30XDriver = WasmDriver
export const SCServoDriver = WasmDriver
