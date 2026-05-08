type Rotation = { y: number; p: number; r: number }
type Maybe<T> = { success: true; value: T } | { success: false; error?: string }

type HostDriverBridge = {
  applyRotation?: (message: { rotation: Rotation; time?: number }) => void
  setTorque?: (torque: boolean) => void
  getRotation?: () => Rotation | undefined
}

type WasmHost = {
  Driver?: HostDriverBridge
}

declare global {
  // Browser-side simulator code may install this before the Moddable WASM app starts.
  var Host: WasmHost | undefined
}

const ZERO_ROTATION: Rotation = { y: 0, p: 0, r: 0 }

export class WasmDriver {
  #rotation: Rotation = { ...ZERO_ROTATION }

  constructor(_options?: unknown) {
    void _options
  }

  async applyRotation(rotation: Rotation, time?: number): Promise<void> {
    this.#rotation = { ...rotation }
    globalThis.Host?.Driver?.applyRotation?.({ rotation, time })
  }

  async getRotation(): Promise<Maybe<Rotation>> {
    const rotation = globalThis.Host?.Driver?.getRotation?.() ?? this.#rotation
    return { success: true, value: { ...rotation } }
  }

  async setTorque(torque: boolean): Promise<void> {
    globalThis.Host?.Driver?.setTorque?.(torque)
  }
}

export const DynamixelDriver = WasmDriver
export const NoneDriver = WasmDriver
export const PWMServoDriver = WasmDriver
export const RS30XDriver = WasmDriver
export const SCServoDriver = WasmDriver
