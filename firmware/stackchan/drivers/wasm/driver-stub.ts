type Rotation = { y: number; p: number; r: number }
type Maybe<T> = { success: true; value: T } | { success: false; error?: string }

const ZERO_ROTATION: Rotation = { y: 0, p: 0, r: 0 }

class WasmDriver {
  constructor(_options?: unknown) {}
  async applyRotation(_rotation: unknown, _time?: number): Promise<void> {}
  async getRotation(): Promise<Maybe<Rotation>> {
    return { success: true, value: { ...ZERO_ROTATION } }
  }
  async setTorque(_torque: boolean): Promise<void> {}
}

export class DynamixelDriver extends WasmDriver {}
export class NoneDriver extends WasmDriver {}
export class PWMServoDriver extends WasmDriver {}
export class RS30XDriver extends WasmDriver {}
export class SCServoDriver extends WasmDriver {}
