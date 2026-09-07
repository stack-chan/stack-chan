import { SETTING_KEYS, SETTINGS_MESSAGE_MAX_BYTES, SETTINGS_PROTOCOL_VERSION, type SettingKey } from 'settings-schema'
import type { SettingsService } from 'settings-service'
import { StackchanError } from 'stackchan/errors'
import Timer from 'timer'
import { SERVICE_UUID, UARTServer } from 'uartserver'

type PreferenceServerProps = {
  settings: Pick<SettingsService, 'get' | 'describe' | 'write'>
  onPreferenceChanged?: (key: SettingKey, value: string | number | undefined) => void
  onConnected?: () => void
  onDisconnected?: () => void
}
type Characteristic = { name: string }

/** Setup-only transport. Validation, precedence and secret redaction belong to SettingsService. */
export class PreferenceServer extends UARTServer {
  readonly #options: PreferenceServerProps
  #closed = false
  #tx?: Characteristic
  #txQueue: ArrayBuffer[] = []
  #txBytes = 0
  #txOffset = 0
  #txTimer?: ReturnType<typeof Timer.set>
  #chunkSize = 20 // The default ATT MTU is 23, including three protocol bytes.
  #rx?: Uint8Array
  #rxLength = 0
  #rxTimer?: ReturnType<typeof Timer.set>

  constructor(options: PreferenceServerProps) {
    super()
    this.deviceName = 'STK'
    this.#options = options
  }

  onConnected() {
    if (this.#closed) return
    super.onConnected()
    this.#options.onConnected?.()
  }

  onDisconnected() {
    if (this.#closed) return
    this.#clearIO()
    this.#chunkSize = 20
    this.startAdvertising({
      advertisingData: { flags: 6, completeName: this.deviceName, completeUUID128List: [SERVICE_UUID] },
    })
    this.#options?.onDisconnected?.()
  }

  onMTUExchanged(mtu: number) {
    if (Number.isInteger(mtu) && mtu >= 23) this.#chunkSize = Math.min(128, mtu - 3)
  }

  onCharacteristicNotifyEnabled(characteristic: Characteristic) {
    if (this.#closed || characteristic.name !== 'tx') return
    this.#clearIO()
    this.#tx = characteristic
    this.#notify({ kind: 'hello', protocol: SETTINGS_PROTOCOL_VERSION })
    try {
      for (const key of SETTING_KEYS) this.#notify(this.#options.settings.describe(key))
      this.#notify({ kind: 'ready' })
    } catch {
      this.#notify({ kind: 'error', code: 'IO', message: 'Settings could not be read' })
    }
  }

  onCharacteristicNotifyDisabled(characteristic: Characteristic) {
    if (characteristic.name === 'tx') this.#clearIO()
  }

  onCharacteristicWritten(characteristic: Characteristic, value: ArrayBuffer) {
    if (characteristic.name === 'rx') this.onRX(value)
  }

  onRX(data: ArrayBuffer) {
    if (this.#closed || !this.#tx) return
    if (data.byteLength > SETTINGS_MESSAGE_MAX_BYTES - this.#rxLength) {
      this.#resetRX()
      this.#notify({ kind: 'error', code: 'INVALID_ARGUMENT', message: 'Settings message is too large' })
      return
    }
    this.#rx ??= new Uint8Array(SETTINGS_MESSAGE_MAX_BYTES)
    this.#rx.set(new Uint8Array(data), this.#rxLength)
    this.#rxLength += data.byteLength
    if (this.#rxTimer === undefined)
      this.#rxTimer = Timer.set(() => {
        this.#rxTimer = undefined
        this.#resetRX()
        this.#notify({ kind: 'error', code: 'TIMEOUT', message: 'Settings message was incomplete' })
      }, 3000)
    let message: unknown
    let end = this.#rxLength - 1
    while (end >= 0 && this.#rx[end] <= 32) end--
    if (this.#rx[end] !== 125 && this.#rx[end] !== 93) return
    try {
      // Decode the whole byte sequence: an incoming chunk may split a UTF-8 character.
      message = JSON.parse(String.fromArrayBuffer((this.#rx.buffer as ArrayBuffer).slice(0, this.#rxLength)))
    } catch {
      return
    }
    this.#resetRX()
    let requestId: number | undefined
    try {
      if (!message || typeof message !== 'object' || Array.isArray(message))
        throw new StackchanError('INVALID_ARGUMENT', 'Invalid settings request')
      const request = message as Record<string, unknown>
      if (typeof request.requestId === 'number' && Number.isSafeInteger(request.requestId) && request.requestId > 0)
        requestId = request.requestId
      if (requestId === undefined || Object.keys(request).some((key) => key !== 'requestId' && key !== '_batch'))
        throw new StackchanError('INVALID_ARGUMENT', 'Invalid settings request')
      const changes = this.#options.settings.write(request._batch as Record<string, unknown>)
      let applyFailed = false
      for (const change of changes) {
        try {
          this.#options.onPreferenceChanged?.(change.prop, this.#options.settings.get(change.prop))
        } catch {
          applyFailed = true
        }
        this.#notify(change)
      }
      this.#notify({
        kind: 'saved',
        requestId,
        applications: [...new Set(changes.map((change) => change.application))],
        applyFailed,
      })
    } catch (error) {
      this.#notify({
        kind: 'error',
        requestId,
        code: error instanceof StackchanError ? error.code : 'IO',
        message: error instanceof StackchanError ? error.message : 'Settings could not be saved',
      })
    }
  }

  close() {
    if (this.#closed) return
    this.#closed = true
    this.#clearIO()
    super.close()
  }

  #notify(message: object) {
    if (this.#closed || !this.#tx) return
    const bytes = ArrayBuffer.fromString(`${JSON.stringify(message)}\n`)
    if (bytes.byteLength > SETTINGS_MESSAGE_MAX_BYTES - this.#txBytes) {
      // Stop this transport instead of reporting a save whose response cannot be delivered.
      this.#clearIO()
      return
    }
    this.#txQueue.push(bytes)
    this.#txBytes += bytes.byteLength
    if (this.#txTimer === undefined) this.#txTimer = Timer.repeat(() => this.#flushTX(), 5)
  }

  #flushTX() {
    const bytes = this.#txQueue[0]
    if (this.#closed || !this.#tx || !bytes) return
    const end = Math.min(bytes.byteLength, this.#txOffset + this.#chunkSize)
    try {
      this.notifyValue(this.#tx, bytes.slice(this.#txOffset, end))
    } catch {
      this.#clearIO()
      return
    }
    this.#txOffset = end
    if (end === bytes.byteLength) {
      this.#txBytes -= bytes.byteLength
      this.#txQueue.shift()
      this.#txOffset = 0
    }
    if (!this.#txQueue.length && this.#txTimer !== undefined) {
      Timer.clear(this.#txTimer)
      this.#txTimer = undefined
    }
  }

  #resetRX() {
    if (this.#rxTimer !== undefined) Timer.clear(this.#rxTimer)
    this.#rxTimer = undefined
    this.#rx = undefined
    this.#rxLength = 0
  }

  #clearIO() {
    this.#resetRX()
    if (this.#txTimer !== undefined) Timer.clear(this.#txTimer)
    this.#txTimer = undefined
    this.#txQueue = []
    this.#txBytes = 0
    this.#txOffset = 0
    this.#tx = undefined
  }
}
