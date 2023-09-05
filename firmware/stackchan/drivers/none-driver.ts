import type { Maybe, Rotation } from 'stackchan-util'

export class NoneDriver {
  constructor() {
    // do nothing
  }

  async setTorque(): Promise<void> {
    // do nothing
  }

  async applyRotation(): Promise<void> {
    // do nothing
  }

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
