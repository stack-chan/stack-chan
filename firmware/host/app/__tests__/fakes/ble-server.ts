export default class FakeBLEServer {
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
