import BLEServer from 'bleserver'
import { uuid } from 'btutils'

const DEVICE_NAME = 'stk'
const SERVICE_UUID = '450f932b-bb09-4fe3-9856-6f66ddcc43ec'
// const CHARACTERISTIC_UUID = 'a2abc192-26aa-45d9-aa17-42db27585c57'

class StkServer extends BLEServer {
  #handleReceive
  #handleConnected
  #handleDisconnected
  constructor(options) {
    super(options)
    this.#handleReceive = options.onReceive
    this.#handleConnected = options.onConnected
    this.#handleDisconnected = options.onDisconnected
  }
  onReady() {
    this.qr = ''
    this.deviceName = DEVICE_NAME
    this.onDisconnected()
  }
  onConnected(connection) {
    this.stopAdvertising()
    this.#handleConnected?.()
  }
  onDisconnected(connection) {
    this.startAdvertising({
      advertisingData: {
        flags: 6,
        completeName: DEVICE_NAME,
        completeUUID128List: [uuid([SERVICE_UUID])],
      },
    })
    this.#handleDisconnected?.()
  }
  onCharacteristicWritten(params, value) {
    if (params.name === 'stk') {
      const pose = JSON.parse(String.fromArrayBuffer(value))
      this.#handleReceive?.(pose)
    }
  }
}

export default StkServer
