import type { Maybe, Rotation } from '../stackchan-util'

export class NoneDriver {
  constructor(param: unknown) {}

  async setTorque(torque: boolean): Promise<void> {}

  async applyRotation(ori: Rotation, time = 0.5): Promise<void> {}

  async getRotation(): Promise<Maybe<Rotation>> {
    return {
      success: true,
      value: {
        y: 0.0,
        p: 0.0,
        r: 0.0,
      },
    }
  }
}
