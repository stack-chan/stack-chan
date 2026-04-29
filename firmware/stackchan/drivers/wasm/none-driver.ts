export class NoneDriver {
  constructor(_options?: unknown) {}
  async applyRotation(_rotation: unknown, _time?: number): Promise<void> {}
  async getRotation(): Promise<null> {
    return null
  }
  async setTorque(_torque: boolean): Promise<void> {}
}
