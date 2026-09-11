export default class FakeBLEServer {
  static instances: FakeBLEServer[] = []
  scans: unknown[] = []
  constructor() {
    FakeBLEServer.instances.push(this)
  }
  startScanning(options: unknown) {
    this.scans.push(options)
  }
  advertising: unknown[] = []
  advertisingStops = 0
  closeCalls = 0
  startAdvertising(options: unknown) {
    this.advertising.push(options)
  }
  stopAdvertising() {
    this.advertisingStops++
  }
  close() {
    this.closeCalls++
  }
}

export const uuid = (value: unknown) => value

// Packet encoding has a separate XS test using the real btutils C implementation.
export class Bytes {}
export class BeaconDataPacket {
  readonly payload: number[]
  constructor(_uuid: unknown, sequence: number, command: number, _power: number) {
    this.payload = [sequence, command]
  }
  static parse(_data: unknown): never {
    throw new Error('unexpected packet parsing')
  }
}
