import { DOMAIN, type PREF_KEYS } from 'consts'
import Preference from 'preference'
import Timer from 'timer'
import { SERVICE_UUID, UARTServer } from 'uartserver'
import { decodeVolumePreference, encodeVolumePreference } from 'volume-model'

type PreferenceValue = string | boolean | number | ArrayBuffer

type PreferenceServerProps = {
  onPreferenceChanged?: (key: string, value: ReturnType<(typeof Preference)['get']>) => void
  onConnected?: () => void
  onDisconnected?: () => void
  keys?: typeof PREF_KEYS
  effectiveValues?: Readonly<Record<string, PreferenceValue>>
  readOnlyKeys?: readonly string[]
}

function isVolumePreference(domain: string, key: string): boolean {
  return domain === DOMAIN.tts && key === 'volume'
}

function isPreferenceValue(value: unknown): value is PreferenceValue {
  return (
    typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' || value instanceof ArrayBuffer
  )
}

function readPreferenceValue(
  domain: string,
  key: string,
  storedValue: ReturnType<(typeof Preference)['get']>,
  effectiveValue: PreferenceValue | undefined,
): PreferenceValue | undefined {
  const value = storedValue ?? effectiveValue
  if (value == null) return undefined
  if (isVolumePreference(domain, key)) {
    return decodeVolumePreference(value, typeof effectiveValue === 'number' ? effectiveValue : undefined)
  }
  return isPreferenceValue(value) ? value : effectiveValue
}

function encodePreferenceValue(domain: string, key: string, value: PreferenceValue): PreferenceValue {
  return isVolumePreference(domain, key) ? encodeVolumePreference(value) : value
}

export class PreferenceServer extends UARTServer {
  #tx_characteristic
  #keys
  #effectiveValues
  #readOnlyKeys
  #rxBuffer = ''
  #timeout
  #handlePreferenceChanged?: (key: string, value: PreferenceValue) => void
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
    this.#keys = Array.isArray(option?.keys) ? option.keys.slice() : []
    this.#effectiveValues = option?.effectiveValues ?? {}
    this.#readOnlyKeys = option?.readOnlyKeys ?? []
  }
  onConnected() {
    super.onConnected()
    this.#handleConnected?.()
  }
  onDisconnected() {
    this.startAdvertising({
      advertisingData: {
        flags: 6,
        completeName: this.deviceName,
        completeUUID128List: [SERVICE_UUID],
      },
    })
    this.#handleDisconnected?.()
  }
  onCharacteristicNotifyEnabled(characteristic) {
    if ('tx' === characteristic.name) {
      this.#tx_characteristic = characteristic
      for (const item of this.#keys) {
        const [domain, key] = item
        const prop = `${domain}.${key}`
        const readOnly = this.#readOnlyKeys.includes(prop)
        const currentValue = readOnly
          ? this.#effectiveValues[prop]
          : readPreferenceValue(domain, key, Preference.get(domain, key), this.#effectiveValues[prop])
        if (currentValue != null) {
          this.notifyPreference(prop, currentValue, readOnly)
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
    trace(`${this.#rxBuffer}\n`)
    let _batch: object
    let prop: string
    let value: PreferenceValue
    try {
      const obj = JSON.parse(this.#rxBuffer)
      _batch = obj._batch
      prop = obj.prop
      value = obj.value
    } catch (_e) {
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

  notifyPreference(prop, value, readOnly = false) {
    if (this.#tx_characteristic == null) {
      return
    }
    this.notifyValue(
      this.#tx_characteristic,
      ArrayBuffer.fromString(
        JSON.stringify({
          prop,
          value,
          ...(readOnly ? { readOnly: true } : {}),
        }),
      ),
    )
  }

  receiveAndSetPreference(domain: string, key: string, value: PreferenceValue) {
    const prop = `${domain}.${key}`
    if (this.#readOnlyKeys.includes(prop)) {
      trace(`ignoring read-only preference ... ${prop}: ${value}\n`)
      const currentValue = this.#effectiveValues[prop]
      if (currentValue != null) this.notifyPreference(prop, currentValue, true)
      return
    }
    const currentValue = readPreferenceValue(domain, key, Preference.get(domain, key), this.#effectiveValues[prop])
    const nextValue = isVolumePreference(domain, key)
      ? decodeVolumePreference(value, typeof currentValue === 'number' ? currentValue : undefined)
      : value
    if (currentValue !== nextValue) {
      trace(`changing preference ... ${domain}.${key}: ${nextValue}\n`)
      Preference.set(domain, key, encodePreferenceValue(domain, key, nextValue))
      this.notifyPreference(prop, nextValue)
      this.#handlePreferenceChanged?.(prop, nextValue)
    }
  }
}
