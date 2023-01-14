/**
 * @note type definitions of `btutils` exists in moddable/typings/ble.d.ts but cannot import
 */
declare module 'btutils' {
  export class Bytes extends ArrayBuffer {
    constructor(bytes: string | ArrayBufferLike, littleEndian?: boolean)
    equals(bytes: Bytes): boolean
  }
}
