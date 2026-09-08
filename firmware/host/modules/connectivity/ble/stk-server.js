import BLEServer from 'bleserver'
import { uuid } from 'btutils'
import { StackchanError } from 'stackchan/errors'

const DEVICE_NAME = 'stk'
const SERVICE_UUID = '450f932b-bb09-4fe3-9856-6f66ddcc43ec'

class StkServer extends BLEServer {
  #handleReceive
  #handleConnected
  #handleDisconnected
  #handleError
  #closed = false
  constructor(options) {
    super(options)
    this.#handleReceive = options.onReceive
    this.#handleConnected = options.onConnected
    this.#handleDisconnected = options.onDisconnected
    this.#handleError = options.onError
  }
  onReady() {
    if (this.#closed) return
    this.qr = ''
    this.deviceName = DEVICE_NAME
    this.onDisconnected()
  }
  onConnected(_connection) {
    if (this.#closed) return
    this.stopAdvertising()
    this.#handleConnected?.()
  }
  onDisconnected(_connection) {
    if (this.#closed) return
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
    if (this.#closed || params.name !== 'stk') return
    let message
    try {
      if (!(value instanceof ArrayBuffer) || value.byteLength > 2048) throw new Error('Invalid packet size')
      message = JSON.parse(String.fromArrayBuffer(value))
    } catch {
      this.#handleError?.(new StackchanError('INVALID_ARGUMENT', 'Invalid STK message'))
      return
    }
    this.#handleReceive?.(message)
  }
  close() {
    if (this.#closed) return
    this.#closed = true
    super.close()
  }
}

export default StkServer
