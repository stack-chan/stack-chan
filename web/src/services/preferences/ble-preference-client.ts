import { AppError } from '@/lib/errors/app-error'

const SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
const RX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'
const TX_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'

type CharacteristicValueEvent = { target: { value: BufferSource } }
type CharacteristicValueListener = (event: CharacteristicValueEvent) => void
type DisconnectListener = () => void

type BluetoothCharacteristic = {
  addEventListener: (name: string, listener: CharacteristicValueListener) => void
  removeEventListener: (name: string, listener: CharacteristicValueListener) => void
  startNotifications: () => Promise<void>
  writeValue: (value: BufferSource) => Promise<void>
}

type BluetoothDevice = {
  gatt?: {
    connected: boolean
    connect: () => Promise<{
      getPrimaryService: (uuid: string) => Promise<{
        getCharacteristic: (uuid: string) => Promise<BluetoothCharacteristic>
      }>
    }>
    disconnect: () => void
  }
  addEventListener: (name: string, listener: DisconnectListener) => void
  removeEventListener: (name: string, listener: DisconnectListener) => void
}

type BluetoothNavigator = Navigator & {
  bluetooth?: {
    requestDevice: (options: unknown) => Promise<BluetoothDevice>
  }
}

export type PreferenceValue = {
  prop: string
  value: unknown
  readOnly?: boolean
}

export interface PreferenceClient {
  onDisconnected?: () => void
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  isConnected: () => boolean
  send: (payload: { _batch: Record<string, string> }) => Promise<void>
}

export class BlePreferenceClient implements PreferenceClient {
  onDisconnected?: () => void
  private readonly deviceName: string
  private readonly onValue: (value: PreferenceValue) => void
  private readonly encoder = new TextEncoder()
  private readonly decoder = new TextDecoder()
  private device?: BluetoothDevice
  private tx?: BluetoothCharacteristic
  private rx?: BluetoothCharacteristic
  private disconnectedDevice?: BluetoothDevice
  private notificationCharacteristic?: BluetoothCharacteristic
  private readonly handleDisconnected = () => {
    this.removeEventListeners()
    this.device = undefined
    this.tx = undefined
    this.rx = undefined
    this.onDisconnected?.()
  }
  private readonly handleValueChanged = (event: CharacteristicValueEvent) => {
    try {
      const decoded = this.decoder.decode(event.target.value)
      this.onValue(JSON.parse(decoded) as PreferenceValue)
    } catch (error) {
      console.warn('[preferences] Invalid BLE notification', error)
    }
  }

  constructor({ deviceName, onValue }: { deviceName: string; onValue: (value: PreferenceValue) => void }) {
    this.deviceName = deviceName
    this.onValue = onValue
  }

  async connect() {
    const bluetooth = (navigator as BluetoothNavigator).bluetooth
    if (!bluetooth) throw new AppError('bluetooth-unavailable', 'このブラウザはWeb Bluetoothに対応していません')
    if (this.device) await this.disconnect()
    const device = await bluetooth.requestDevice({
      acceptAllDevices: false,
      filters: [{ name: this.deviceName }, { services: [SERVICE_UUID] }],
    })
    if (!device.gatt) throw new AppError('gatt-unavailable', '選択したデバイスはGATT接続に対応していません')
    this.device = device
    this.disconnectedDevice = device
    device.addEventListener('gattserverdisconnected', this.handleDisconnected)
    try {
      const server = await device.gatt.connect()
      const service = await server.getPrimaryService(SERVICE_UUID)
      this.rx = await service.getCharacteristic(RX_UUID)
      this.tx = await service.getCharacteristic(TX_UUID)
      this.notificationCharacteristic = this.tx
      this.tx.addEventListener('characteristicvaluechanged', this.handleValueChanged)
      await this.tx.startNotifications()
    } catch (error) {
      this.removeEventListeners()
      device.gatt.disconnect()
      this.device = undefined
      this.tx = undefined
      this.rx = undefined
      throw error
    }
  }

  isConnected() {
    return this.device?.gatt?.connected ?? false
  }

  async disconnect() {
    const device = this.device
    this.removeEventListeners()
    this.device = undefined
    this.tx = undefined
    this.rx = undefined
    device?.gatt?.disconnect()
  }

  async send(payload: { _batch: Record<string, string> }) {
    if (!this.rx || !this.isConnected()) throw new AppError('not-connected', 'ｽﾀｯｸﾁｬﾝへ接続していません')
    const bytes = this.encoder.encode(JSON.stringify(payload))
    for (let index = 0; index < bytes.length; index += 128) {
      await this.rx.writeValue(bytes.slice(index, index + 128))
    }
  }

  private removeEventListeners() {
    this.disconnectedDevice?.removeEventListener('gattserverdisconnected', this.handleDisconnected)
    this.notificationCharacteristic?.removeEventListener('characteristicvaluechanged', this.handleValueChanged)
    this.disconnectedDevice = undefined
    this.notificationCharacteristic = undefined
  }
}
