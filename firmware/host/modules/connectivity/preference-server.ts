import type { PREF_KEYS } from 'consts'
import Preference from 'preference'
import { isAllowedPreferenceWrite, parsePreferenceProperty } from 'preference-write-guard'
import Time from 'time'
import Timer from 'timer'
import { SERVICE_UUID, UARTServer } from 'uartserver'

type PreferenceValue = string | boolean | number | ArrayBuffer

type PreferenceServerProps = {
  onPreferenceChanged?: (key: string, value: ReturnType<(typeof Preference)['get']>) => void
  onConnected?: () => void
  onDisconnected?: () => void
  keys?: typeof PREF_KEYS
  effectiveValues?: Readonly<Record<string, PreferenceValue>>
  readOnlyKeys?: readonly string[]
}
export class PreferenceServer extends UARTServer {
  #tx_characteristic
  #keys
  #effectiveValues
  #readOnlyKeys
  #rxBuffer = ''
  #timeout
  #writesEnabled = false
  #writeWindowTimer
  #writeWindowStartedTicks?: number
  #writeWindowDurationMs = 0
  #closed = false
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

  // Only an explicit on-device setup action should open a bounded write window.
  enableWrites(durationMs: number) {
    this.disableWrites()
    if (this.#closed || !Number.isFinite(durationMs) || durationMs <= 0) return
    const startedTicks = Time.ticks
    if (!Number.isFinite(startedTicks)) return
    this.#writeWindowTimer = Timer.set(() => {
      this.#writeWindowTimer = undefined
      this.disableWrites()
      trace('BLE preference write window closed\n')
    }, durationMs)
    this.#writeWindowStartedTicks = startedTicks
    this.#writeWindowDurationMs = durationMs
    this.#writesEnabled = true
  }

  disableWrites() {
    this.#writesEnabled = false
    this.#writeWindowStartedTicks = undefined
    this.#writeWindowDurationMs = 0
    if (this.#writeWindowTimer != null) {
      Timer.clear(this.#writeWindowTimer)
      this.#writeWindowTimer = undefined
    }
    this.#clearReceiveBuffer()
  }

  #isWriteWindowOpen() {
    if (!this.#writesEnabled || this.#closed) return false
    try {
      if (this.#writeWindowStartedTicks != null) {
        const elapsed = Time.delta(this.#writeWindowStartedTicks)
        if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < this.#writeWindowDurationMs) return true
      }
    } catch (_error) {
      // A failed clock must not turn a bounded window into an unbounded one.
    }
    this.disableWrites()
    return false
  }

  #clearReceiveBuffer() {
    this.#rxBuffer = ''
    if (this.#timeout != null) {
      Timer.clear(this.#timeout)
      this.#timeout = undefined
    }
  }

  close() {
    if (this.#closed) return
    this.#closed = true
    this.disableWrites()
    this.#tx_characteristic = null
    super.close()
  }

  onConnected() {
    super.onConnected()
    this.#handleConnected?.()
  }
  onDisconnected() {
    this.#clearReceiveBuffer()
    this.#tx_characteristic = null
    if (this.#closed) return
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
          : (Preference.get(domain, key) ?? this.#effectiveValues[prop])
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
    if (!this.#isWriteWindowOpen()) return
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
    this.#clearReceiveBuffer()
    if (_batch != null) {
      if (typeof _batch !== 'object' || Array.isArray(_batch)) return
      for (const [prop, value] of Object.entries(_batch)) {
        const property = parsePreferenceProperty(prop)
        if (property) this.receiveAndSetPreference(property.domain, property.key, value)
      }
    } else if (prop != null && value != null) {
      const property = parsePreferenceProperty(prop)
      if (property) this.receiveAndSetPreference(property.domain, property.key, value)
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
    if (!isAllowedPreferenceWrite(this.#keys, this.#isWriteWindowOpen(), domain, key)) {
      trace(`rejected BLE preference write: ${domain}.${key}\n`)
      return
    }
    const prop = `${domain}.${key}`
    if (this.#readOnlyKeys.includes(prop)) {
      trace(`ignoring read-only preference ... ${prop}: ${value}\n`)
      const currentValue = this.#effectiveValues[prop]
      if (currentValue != null) this.notifyPreference(prop, currentValue, true)
      return
    }
    const currentValue = Preference.get(domain, key) ?? this.#effectiveValues[prop]
    if (currentValue !== value) {
      trace(`changing preference ... ${domain}.${key}: ${value}\n`)
      // Parsing, storage reads or earlier batch callbacks may have crossed expiry.
      if (!this.#isWriteWindowOpen()) return
      Preference.set(domain, key, value)
      this.notifyPreference(prop, value)
      this.#handlePreferenceChanged?.(prop, value)
    }
  }
}
