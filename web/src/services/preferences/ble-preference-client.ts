import {
  SETTINGS_MESSAGE_MAX_BYTES,
  SETTINGS_PROTOCOL_VERSION,
  type SettingApplication,
  type SettingsSaveReceipt,
} from '../../../../firmware/host/modules/preferences/settings-schema'
import { AppError } from '@/lib/errors/app-error'

const SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
const RX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'
const TX_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'
type CharacteristicValueEvent = { target: { value: BufferSource } }
type CharacteristicValueListener = (event: CharacteristicValueEvent) => void
type DisconnectListener = () => void
type BluetoothCharacteristic = {
  addEventListener(name: string, listener: CharacteristicValueListener): void
  removeEventListener(name: string, listener: CharacteristicValueListener): void
  startNotifications(): Promise<void>
  writeValue(value: BufferSource): Promise<void>
}
type BluetoothDevice = {
  gatt?: {
    connected: boolean
    connect(): Promise<{
      getPrimaryService(uuid: string): Promise<{ getCharacteristic(uuid: string): Promise<BluetoothCharacteristic> }>
    }>
    disconnect(): void
  }
  addEventListener(name: string, listener: DisconnectListener): void
  removeEventListener(name: string, listener: DisconnectListener): void
}
type BluetoothNavigator = Navigator & { bluetooth?: { requestDevice(options: unknown): Promise<BluetoothDevice> } }
export type PreferenceValue = {
  prop: string
  value: unknown
  readOnly?: boolean
  secret?: boolean
  configured?: boolean
  application?: SettingApplication
}
export type { SettingsSaveReceipt }
export interface PreferenceClient {
  onDisconnected?: () => void
  connect(): Promise<void>
  disconnect(): Promise<void>
  isConnected(): boolean
  send(payload: { _batch: Record<string, string> }): Promise<SettingsSaveReceipt | void>
}

export class BlePreferenceClient implements PreferenceClient {
  onDisconnected?: () => void
  private readonly deviceName: string
  private readonly onValue: (value: PreferenceValue) => void
  private readonly encoder = new TextEncoder()
  private decoder = new TextDecoder()
  private buffer = ''
  private bufferedBytes = 0
  private protocol = 1
  private hello?: () => void
  private device?: BluetoothDevice
  private tx?: BluetoothCharacteristic
  private rx?: BluetoothCharacteristic
  private epoch = 0
  private requestId = 0
  private sending = false
  private pending?: {
    id: number
    resolve(receipt: SettingsSaveReceipt): void
    reject(error: AppError): void
    timer: ReturnType<typeof setTimeout>
  }
  private readonly handleDisconnected = () => {
    this.reset()
    this.onDisconnected?.()
  }
  private readonly handleValueChanged = (event: CharacteristicValueEvent) => {
    this.bufferedBytes += event.target.value.byteLength
    if (this.bufferedBytes > SETTINGS_MESSAGE_MAX_BYTES) {
      this.buffer = ''
      this.bufferedBytes = 0
      this.decoder = new TextDecoder()
      this.failPending(new AppError('invalid-notification', '本体からの設定応答を読み取れませんでした'))
      return
    }
    this.buffer += this.decoder.decode(event.target.value, { stream: true })
    let end = this.buffer.indexOf('\n')
    while (end >= 0) {
      const frame = this.buffer.slice(0, end)
      this.buffer = this.buffer.slice(end + 1)
      if (frame.trim()) this.receive(frame)
      end = this.buffer.indexOf('\n')
    }
    // Older firmware sent one unframed JSON document per notification.
    if (this.buffer.trim()) {
      try {
        JSON.parse(this.buffer)
      } catch {
        return
      }
      const frame = this.buffer
      this.buffer = ''
      this.receive(frame)
    }
    this.bufferedBytes = this.encoder.encode(this.buffer).byteLength
  }

  constructor({ deviceName, onValue }: { deviceName: string; onValue: (value: PreferenceValue) => void }) {
    this.deviceName = deviceName
    this.onValue = onValue
  }

  async connect() {
    const bluetooth = (navigator as BluetoothNavigator).bluetooth
    if (!bluetooth) throw new AppError('bluetooth-unavailable', 'このブラウザはWeb Bluetoothに対応していません')
    await this.disconnect()
    const epoch = ++this.epoch
    const device = await bluetooth.requestDevice({
      acceptAllDevices: false,
      filters: [{ name: this.deviceName }, { services: [SERVICE_UUID] }],
    })
    this.checkEpoch(epoch)
    if (!device.gatt) throw new AppError('gatt-unavailable', '選択したデバイスはGATT接続に対応していません')
    this.device = device
    device.addEventListener('gattserverdisconnected', this.handleDisconnected)
    try {
      const server = await device.gatt.connect()
      this.checkEpoch(epoch)
      const service = await server.getPrimaryService(SERVICE_UUID)
      this.checkEpoch(epoch)
      const rx = await service.getCharacteristic(RX_UUID)
      this.checkEpoch(epoch)
      const tx = await service.getCharacteristic(TX_UUID)
      this.checkEpoch(epoch)
      this.rx = rx
      this.tx = tx
      tx.addEventListener('characteristicvaluechanged', this.handleValueChanged)
      await tx.startNotifications()
      this.checkEpoch(epoch)
    } catch (error) {
      if (this.epoch === epoch) {
        this.reset()
        device.gatt.disconnect()
      }
      throw error
    }
  }

  isConnected() {
    return this.device?.gatt?.connected ?? false
  }

  async disconnect() {
    const device = this.device
    this.reset()
    device?.gatt?.disconnect()
  }

  async send(payload: { _batch: Record<string, string> }): Promise<SettingsSaveReceipt> {
    if (!this.rx || !this.isConnected()) throw new AppError('not-connected', 'ｽﾀｯｸﾁｬﾝへ接続していません')
    if (this.sending) throw new AppError('busy', '設定の保存応答を待っています')
    this.sending = true
    const epoch = this.epoch
    const rx = this.rx
    try {
      if (this.protocol !== SETTINGS_PROTOCOL_VERSION)
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            this.hello = undefined
            resolve()
          }, 1500)
          this.hello = () => {
            clearTimeout(timer)
            this.hello = undefined
            resolve()
          }
        })
      this.checkEpoch(epoch)
      const id = ++this.requestId
      const confirmed = this.protocol === SETTINGS_PROTOCOL_VERSION
      const bytes = this.encoder.encode(JSON.stringify({ ...payload, requestId: id }))
      if (bytes.byteLength > SETTINGS_MESSAGE_MAX_BYTES)
        throw new AppError('settings-too-large', '設定が長すぎます。内容を短くして再試行してください')
      const ack = confirmed
        ? new Promise<SettingsSaveReceipt>((resolve, reject) => {
            const timer = setTimeout(
              () =>
                this.failPending(
                  new AppError('save-timeout', '本体の保存結果を確認できませんでした。接続して設定を確認してください')
                ),
              10000
            )
            this.pending = { id, resolve, reject, timer }
          })
        : undefined
      // A disconnect can reject while a Bluetooth write is still pending.
      void ack?.catch(() => {})
      for (let index = 0; index < bytes.length; index += 128) {
        this.checkEpoch(epoch)
        await rx.writeValue(bytes.slice(index, index + 128))
      }
      this.checkEpoch(epoch)
      return ack ? await ack : { confirmed: false }
    } catch (error) {
      if (this.epoch === epoch) this.failPending(new AppError('save-interrupted', '設定の保存を完了できませんでした'))
      throw error
    } finally {
      if (this.epoch === epoch) this.sending = false
    }
  }

  private receive(frame: string) {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(frame)
    } catch {
      this.failPending(new AppError('invalid-notification', '本体からの設定応答を読み取れませんでした'))
      return
    }
    if (!message || typeof message !== 'object') return
    if (message.kind === 'hello' && message.protocol === SETTINGS_PROTOCOL_VERSION) {
      this.protocol = SETTINGS_PROTOCOL_VERSION
      this.hello?.()
      return
    }
    if (typeof message.prop === 'string') {
      this.onValue(message as PreferenceValue)
      return
    }
    const pending = this.pending
    if (!pending || message.requestId !== pending.id) return
    if (message.kind === 'saved') {
      clearTimeout(pending.timer)
      this.pending = undefined
      const applications = Array.isArray(message.applications)
        ? message.applications.filter((value): value is SettingApplication =>
            ['live', 'reconnect', 'restart'].includes(value)
          )
        : []
      pending.resolve({ confirmed: true, applications, applyFailed: message.applyFailed === true })
    } else if (message.kind === 'error') {
      const code = typeof message.code === 'string' ? message.code : 'IO'
      this.failPending(
        new AppError(
          code,
          code === 'INVALID_ARGUMENT'
            ? '設定値の種類・範囲・長さを確認してください'
            : code === 'CONFIG'
              ? '本体で固定された設定は変更できません'
              : '本体が設定を保存できませんでした'
        )
      )
    }
  }

  private checkEpoch(epoch: number) {
    if (epoch !== this.epoch) throw new AppError('disconnected', '設定の接続が切り替わりました')
  }

  private failPending(error: AppError) {
    const pending = this.pending
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending = undefined
    pending.reject(error)
  }

  private reset() {
    this.device?.removeEventListener('gattserverdisconnected', this.handleDisconnected)
    this.tx?.removeEventListener('characteristicvaluechanged', this.handleValueChanged)
    this.epoch += 1
    this.hello?.()
    this.failPending(new AppError('disconnected', '保存結果を確認する前に接続が切れました'))
    this.device = undefined
    this.tx = undefined
    this.rx = undefined
    this.buffer = ''
    this.bufferedBytes = 0
    this.decoder = new TextDecoder()
    this.protocol = 1
    this.sending = false
  }
}
