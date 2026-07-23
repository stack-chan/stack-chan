import {
  BLE_LOCAL_PEER_BROADCAST_ID,
  BLE_LOCAL_PEER_CHUNK_BYTES,
  BLELocalPeerRecordDecoder,
  BLELocalPeerRecordKind,
  encodeBLELocalPeerRecord,
  peerIdToBytes,
} from 'ble-local-peer-record'
import {
  authenticationTagsEqual,
  createLocalPeerAuthenticationTag,
  deriveLocalPeerAuthenticationKey,
} from 'local-peer-auth'
import { copyArrayBuffer } from 'local-peer-codec'
import type { LocalPeerRadio, LocalPeerRadioOptions } from 'local-peer-radio-types'
import { SERVICE_UUID, UARTServer } from 'uartserver'

// A legacy BLE advertising packet is limited to 31 bytes. Flags, this name,
// and the 128-bit UART service UUID occupy 26 bytes in total.
const BLE_DEVICE_NAME = 'STK'

class BLELocalPeerServer extends UARTServer {
  #radio: BLELocalPeerRadio

  constructor(radio: BLELocalPeerRadio) {
    super()
    this.#radio = radio
    this.deviceName = BLE_DEVICE_NAME
  }

  onConnected(): void {
    super.onConnected()
    this.#radio.onConnected()
  }

  onDisconnected(): void {
    this.#radio.onDisconnected()
    this.startAdvertising({
      advertisingData: {
        flags: 6,
        completeName: this.deviceName,
        completeUUID128List: [SERVICE_UUID],
      },
    })
  }

  onCharacteristicNotifyEnabled(characteristic): void {
    if (characteristic.name === 'tx') this.#radio.onNotificationsEnabled(characteristic)
  }

  onCharacteristicNotifyDisabled(characteristic): void {
    if (characteristic.name === 'tx') this.#radio.onNotificationsDisabled(characteristic)
  }

  onRX(data: ArrayBuffer): void {
    this.#radio.onRX(data)
  }
}

class BLELocalPeerRadio implements LocalPeerRadio {
  readonly id: string
  #onReceive: LocalPeerRadioOptions['onReceive']
  #authenticationKey?: Uint8Array
  #server: BLELocalPeerServer
  #decoder = new BLELocalPeerRecordDecoder()
  #remoteId?: string
  #txCharacteristic
  #closed = false

  constructor(id: string, options: LocalPeerRadioOptions) {
    this.id = id
    this.#onReceive = options.onReceive
    this.#authenticationKey = options.sharedKey ? deriveLocalPeerAuthenticationKey(options.sharedKey) : undefined
    this.#server = new BLELocalPeerServer(this)
  }

  addPeer(peerId: string, _secure: boolean): void {
    this.#assertOpen()
    if (this.#remoteId !== peerId) throw new Error(`BLE local peer ${peerId} is not connected`)
  }

  removePeer(_peerId: string): void {}

  async send(peerId: string | undefined, data: ArrayBuffer): Promise<void> {
    this.#assertOpen()
    if (!this.#txCharacteristic || !this.#remoteId) {
      if (peerId === undefined) return
      throw new Error('BLE local peer is not connected')
    }
    if (peerId !== undefined && peerId !== this.#remoteId) throw new Error(`BLE local peer ${peerId} is not connected`)
    const destinationId = peerId ?? BLE_LOCAL_PEER_BROADCAST_ID
    const payload = new Uint8Array(data)
    const authenticated = peerId !== undefined && this.#authenticationKey !== undefined
    const tag = authenticated
      ? createLocalPeerAuthenticationTag(
          this.#authenticationKey as Uint8Array,
          peerIdToBytes(this.id),
          peerIdToBytes(destinationId),
          payload,
        )
      : undefined
    this.#writeRecord(
      encodeBLELocalPeerRecord({
        kind: BLELocalPeerRecordKind.DATA,
        authenticated,
        sourceId: this.id,
        destinationId,
        payload,
        tag,
      }),
    )
  }

  onConnected(): void {
    this.#resetConnection()
  }

  onDisconnected(): void {
    this.#resetConnection()
  }

  onNotificationsEnabled(characteristic): void {
    if (this.#closed) return
    this.#txCharacteristic = characteristic
    this.#writeRecord(
      encodeBLELocalPeerRecord({
        kind: BLELocalPeerRecordKind.HELLO,
        authenticated: false,
        sourceId: this.id,
        destinationId: BLE_LOCAL_PEER_BROADCAST_ID,
        payload: new Uint8Array(0),
      }),
    )
  }

  onNotificationsDisabled(characteristic): void {
    if (this.#txCharacteristic === characteristic) this.#resetConnection()
  }

  onRX(data: ArrayBuffer): void {
    if (this.#closed) return
    for (const record of this.#decoder.push(data)) {
      if (record.sourceId === this.id) continue
      if (record.kind === BLELocalPeerRecordKind.HELLO) {
        if (
          record.authenticated ||
          record.destinationId !== BLE_LOCAL_PEER_BROADCAST_ID ||
          record.payload.byteLength !== 0
        )
          continue
        this.#remoteId = record.sourceId
        continue
      }
      if (record.kind !== BLELocalPeerRecordKind.DATA || record.sourceId !== this.#remoteId) continue
      const broadcast = record.destinationId === BLE_LOCAL_PEER_BROADCAST_ID
      if (!broadcast && record.destinationId !== this.id) continue
      let secure = false
      if (!broadcast && this.#authenticationKey) {
        if (!record.authenticated || !record.tag) continue
        const expected = createLocalPeerAuthenticationTag(
          this.#authenticationKey,
          peerIdToBytes(record.sourceId),
          peerIdToBytes(record.destinationId),
          record.payload,
        )
        if (!authenticationTagsEqual(record.tag, expected)) continue
        secure = true
      } else if (record.authenticated) {
        continue
      }
      this.#onReceive({ peerId: record.sourceId, data: copyArrayBuffer(record.payload), secure })
    }
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#resetConnection()
    this.#server.close()
  }

  #writeRecord(record: ArrayBuffer): void {
    if (!this.#txCharacteristic) return
    const bytes = new Uint8Array(record)
    for (let offset = 0; offset < bytes.byteLength; offset += BLE_LOCAL_PEER_CHUNK_BYTES) {
      const chunk = bytes.slice(offset, offset + BLE_LOCAL_PEER_CHUNK_BYTES)
      this.#server.notifyValue(this.#txCharacteristic, chunk.buffer)
    }
  }

  #resetConnection(): void {
    this.#remoteId = undefined
    this.#txCharacteristic = undefined
    this.#decoder.reset()
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('BLE local peer radio is closed')
  }
}

export default function createBLELocalPeerRadio(options: LocalPeerRadioOptions): LocalPeerRadio {
  peerIdToBytes(options.id)
  return new BLELocalPeerRadio(options.id.toUpperCase(), options)
}
