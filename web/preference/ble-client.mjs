/**
 * A simple BLE UART Client
 */
function isBluetoothAvailable() {
  return navigator.bluetooth != null
}

const SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
const RX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'
const TX_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'

class SimpleBLEClient {
  #deviceName
  #encoder = new TextEncoder()
  #decoder = new TextDecoder()

  #device
  #onCharacteristicValueChanged
  #tx_characteristic
  #rx_characteristic
  constructor({ deviceName, onCharacteristicValueChanged }) {
    this.#deviceName = deviceName
    this.#onCharacteristicValueChanged = onCharacteristicValueChanged
  }

  async connect() {
    if (!isBluetoothAvailable()) {
      throw 'Bluetooth not available'
    }
    if (this.#device != null) {
      await this.disconnect()
    }
    const device = (this.#device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: false,
      filters: [
        {
          name: this.#deviceName,
        },
        {
          services: [SERVICE_UUID],
        },
      ],
    }))
    console.log('device found')
    if (device.gatt == null) {
      throw 'The device has no gatt property'
    }
    device.addEventListener('gattserverdisconnected', () => {
      console.warn('Disconnected')
      this.onDisconnected?.()
    })

    const server = await device.gatt.connect()
    if (server == null) {
      throw 'Gatt connection failed'
    }

    const service = await server.getPrimaryService(SERVICE_UUID)
    this.#rx_characteristic = await service.getCharacteristic(RX_UUID)
    this.#tx_characteristic = await service.getCharacteristic(TX_UUID)
    this.#tx_characteristic.addEventListener('characteristicvaluechanged', (event) => {
      const value = event.target.value
      const str = this.#decoder.decode(value)
      const obj = JSON.parse(str)
      this.#onCharacteristicValueChanged?.(obj)
    })
    await this.#tx_characteristic.startNotifications()
  }

  isConnected() {
    return this.#device?.gatt?.connected ?? false
  }

  async disconnect() {
    this.#device?.gatt?.disconnect()
  }

  async send(obj) {
    const buf = this.#encoder.encode(JSON.stringify(obj))
    await this.#rx_characteristic?.writeValue(buf).catch((reason) => {
      console.warn(`write failed: ${reason}`)
    })
  }
}

export default SimpleBLEClient
