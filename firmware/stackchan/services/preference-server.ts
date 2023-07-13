import { UARTServer } from 'uartserver'
import Preference from 'preference'
import { DOMAIN } from 'consts'

type PreferenceServerProps = {
  onPreferenceChanged?: (key: string, value: ReturnType<typeof Preference['get']>) => void
  onConnected?: () => void
  onDisconnected?: () => void
  keys?: string[]
}
export class PreferenceServer extends UARTServer {
  #tx_characteristic
  #keys
  #handlePreferenceChanged?: (key: string, value: ArrayBuffer) => void
  #handleConnected?: () => void
  #handleDisconnected?: () => void
  constructor(option: PreferenceServerProps) {
    super()
    this.deviceName = 'STK'
    if (option != null) {
      this.#handlePreferenceChanged = option.onPreferenceChanged
      this.#handleConnected = option.onConnected
      this.#handleDisconnected = option.onDisconnected
    }
    this.#keys = Array.isArray(option.keys) ? option.keys.slice() : []
  }
  onConnected() {
    super.onConnected()
    this.#handleConnected?.()
  }
  onDisconnected() {
    super.onDisconnected()
    this.#handleDisconnected?.()
  }
  onCharacteristicNotifyEnabled(characteristic) {
    if ('tx' === characteristic.name) {
      this.#tx_characteristic = characteristic
      for (const key of this.#keys) {
        const currentValue = Preference.get(DOMAIN, key)
        if (currentValue != null) {
          this.notifyPreference(key, currentValue)
        }
      }
    }
  }
  onCharacteristicNotifyDisabled(characteristic) {
    if ('tx' === characteristic.name) {
      this.#tx_characteristic = null
    }
  }
  onCharacteristicWritten(characteristic, value) {
    if ('rx' === characteristic.name) this.onRX(value)
  }
  onRX(data) {
    const { _batch, key, value } = JSON.parse(String.fromArrayBuffer(data))
    if (_batch != null) {
      for (const [key, value] of Object.entries(_batch)) {
        this.receiveAndSetPreference(key, value)
      }
    } else if (key != null && value != null) {
      this.receiveAndSetPreference(key, value)
    } else {
      trace('key/value pair not found\n')
    }
  }

  notifyPreference(key, value) {
    if (this.#tx_characteristic == null) {
      return
    }
    this.notifyValue(
      this.#tx_characteristic,
      ArrayBuffer.fromString(
        JSON.stringify({
          key,
          value,
        })
      )
    )
  }

  receiveAndSetPreference(key, value) {
    const currentValue = Preference.get(DOMAIN, key)
    if (currentValue != value) {
      trace(`changing preference ... ${key}: ${value}\n`)
      Preference.set(DOMAIN, key, value)
      this.notifyPreference(key, value)
      this.#handlePreferenceChanged?.(key, value)
    }
  }
}
