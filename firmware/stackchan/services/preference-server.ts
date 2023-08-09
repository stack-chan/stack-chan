import { UARTServer, SERVICE_UUID } from 'uartserver'
import Preference from 'preference'
import { PREF_KEYS } from 'consts'
import Timer from 'timer'

type PreferenceServerProps = {
  onPreferenceChanged?: (key: string, value: ReturnType<typeof Preference['get']>) => void
  onConnected?: () => void
  onDisconnected?: () => void
  keys?: typeof PREF_KEYS
}
export class PreferenceServer extends UARTServer {
  #tx_characteristic
  #keys
  #rxBuffer = ''
  #timeout
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
    this.startAdvertising({
      advertisingData: { flags: 6, completeName: this.deviceName, completeUUID128List: [SERVICE_UUID] },
    })
    this.#handleDisconnected?.()
  }
  onCharacteristicNotifyEnabled(characteristic) {
    if ('tx' === characteristic.name) {
      this.#tx_characteristic = characteristic
      for (const item of this.#keys) {
        const [domain, key] = item
        const currentValue = Preference.get(domain, key)
        if (currentValue != null) {
          this.notifyPreference(`${domain}.${key}`, currentValue)
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
    this.#rxBuffer += String.fromArrayBuffer(data)
    trace(this.#rxBuffer + '\n')
    let _batch, prop, value
    try {
      const obj = JSON.parse(this.#rxBuffer)
      _batch = obj._batch
      prop = obj.prop
      value = obj.value
    } catch (e) {
      trace('not completed\n')
      if (this.#timeout == null) {
        this.#timeout = Timer.set(() => {
          trace('timeout\n')
          this.#timeout = undefined
          this.#rxBuffer = ''
        }, 3000)
      }
      return
    }
    this.#rxBuffer = ''
    if (this.#timeout != null) {
      Timer.clear(this.#timeout)
      this.#timeout = undefined
    }
    if (_batch != null) {
      for (const [prop, value] of Object.entries(_batch)) {
        const [domain, key] = prop.split('.')
        this.receiveAndSetPreference(domain, key, value)
      }
    } else if (prop != null && value != null) {
      const [domain, key] = prop.split('.')
      this.receiveAndSetPreference(domain, key, value)
    } else {
      trace('key/value pair not found\n')
    }
  }

  notifyPreference(prop, value) {
    if (this.#tx_characteristic == null) {
      return
    }
    this.notifyValue(
      this.#tx_characteristic,
      ArrayBuffer.fromString(
        JSON.stringify({
          prop,
          value,
        })
      )
    )
  }

  receiveAndSetPreference(domain, key, value) {
    const currentValue = Preference.get(domain, key)
    if (currentValue != value) {
      trace(`changing preference ... ${domain}.${key}: ${value}\n`)
      Preference.set(domain, key, value)
      const pref = `${domain}.${key}`
      this.notifyPreference(pref, value)
      this.#handlePreferenceChanged?.(pref, value)
    }
  }
}
