import { Bytes } from 'btutils'
import { Maybe } from './stackchan-util'

/**
 * iBeacon形式のmanufacturerSpecific(0xFF)のうち、identifierを除くdataパケット部を処理する。
 *
 * | オフセット | バイト長 | 説明                                                 |  エンディアン |
 * |------------|----------|--------------------------------------------------------|------------|
 * | 0          | 1        | Type (0x02)                                           |   -        |
 * | 1          | 1        | Data Length (0x15)                                    |   -        |
 * | 2          | 16       | UUID (C5FD FD85 BB67 E09C D4B2 D0BE 5A7E CAC9)        |  Little    |
 * | 18         | 2        | Major (0xC5FD)                                        |  Big       |
 * | 20         | 2        | Minor (0xFD85)                                        |  Big       |
 * | 22         | 1        | Tx Power (0xBB)                                       |   -        |
 */

export class BeaconDataPacket {
  #payload: Uint8Array
  #view: DataView

  /**
   * @param uuid {Bytes}
   * @param major {number}
   * @param minor {number}
   * @param txPower {number}
   */
  constructor(uuid: Bytes, major: number, minor: number, txPower: number) {
    this.#payload = new Uint8Array(23)
    this.#view = new DataView(this.#payload.buffer)
    this.#view.setUint8(0, 0x02)
    this.#view.setUint8(1, 0x15)
    this.#payload.set(new Uint8Array(uuid), 2)
    this.#view.setUint16(18, major, false)
    this.#view.setUint16(20, minor, false)
    this.#view.setUint8(22, txPower)
  }

  /**
   * @param data {Uint8Array}
   */
  static parse(payload: Uint8Array): Maybe<BeaconDataPacket> {
    if (payload.byteLength !== 23) {
      return {
        success: false,
        reason: 'invalid length',
      }
    }
    if (payload[0] !== 0x02 || payload[1] !== 0x15) {
      return {
        success: false,
        reason: 'invalid header',
      }
    }
    const view = new DataView(payload.buffer)
    const uuid = new Bytes(payload.slice(2, 18).buffer, true)
    const major = view.getUint16(18, false)
    const minor = view.getUint16(20, false)
    const txPower = view.getUint8(22)
    return {
      success: true,
      value: new BeaconDataPacket(uuid, major, minor, txPower),
    }
  }

  get type(): number {
    return this.#payload[0]
  }
  get dataLength(): number {
    return this.#payload[1]
  }

  get uuid(): Bytes {
    return new Bytes(this.#payload.slice(2, 18).buffer)
  }
  set uuid(value: Bytes) {
    this.#payload.set(new Uint8Array(value).slice(0, 16), 2)
  }

  get major(): number {
    return this.#view.getUint16(18, false)
  }
  set major(value: number) {
    this.#view.setUint16(18, value, false)
  }

  get minor(): number {
    return this.#view.getUint16(20, false)
  }
  set minor(value: number) {
    this.#view.setUint16(20, value, false)
  }

  get txPower(): number {
    return this.#view.getInt8(22)
  }
  set rxPower(value: number) {
    this.#view.setInt8(22, value)
  }

  get payload(): Uint8Array {
    return this.#payload
  }
}
