const ZERO_ROTATION = { y: 0, p: 0, r: 0 }

class WasmDriver {
  constructor(_options) {}
  async applyRotation(_rotation, _time) {}
  async getRotation() {
    return ZERO_ROTATION
  }
  async setTorque(_torque) {}
}

export class DynamixelDriver extends WasmDriver {}
export class NoneDriver extends WasmDriver {}
export class PWMServoDriver extends WasmDriver {}
export class RS30XDriver extends WasmDriver {}
export class SCServoDriver extends WasmDriver {}
