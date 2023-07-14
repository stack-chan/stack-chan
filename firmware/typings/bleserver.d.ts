declare module 'gatt' {
  import { Bytes, Advertisement } from 'btutils'
  import { GAP } from 'gap'

  type getAddressType = typeof GAP.AddressType

  export interface Client {
    connection: number
    address: Bytes
    addressType: getAddressType
    scanResponse: Advertisement
    rssi: number

    /**
     * Read the connected peripheral's signal strength.
     *
     * @url https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/network/ble/ble.md#readrssi
     */
    readRSSI(): void

    /**
     * Discover a single GATT primary service by UUID.
     *
     * @param uuid
     */
    discoverPrimaryService(uuid: Bytes): void

    /**
     * Discover all the peripheral's GATT primary services.
     * Discovered services are returned to the `onServices` callback.
     */
    discoverAllPrimaryServices(): void

    /**
     * Finds and returns the service identified by `uuid`.
     *
     * @param uuid
     */
    findServiceByUUID(uuid: Bytes): void

    /**
     * Called when service discovery completes.
     * If `findServiceByUUID` was called to find a single service,
     * the `services` array contains the single service found.
     *
     * @param services
     */
    onServices(services: Service[]): void

    /**
     * Terminates the peripheral function.
     */
    close(): void
  }

  /**
   * A single Peripheral GATT service.
   */
  export interface Service {
    connection: number
    uuid: Bytes
    start: number
    end: number
    characteristics: Characteristic[]

    /**
     * Discover all the service characteristics. Discovered characteristics
     * are returned to the `onCharacteristics` callback.
     */
    discoverAllCharacteristics(): void

    /**
     * Discover a single service characteristic by UUID.
     *
     * @param uuid
     * @url https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/network/ble/ble.md#discovercharacteristicuuid
     */
    discoverCharacteristic(uuid: Bytes): void

    /**
     * Called when characteristic discovery completes.
     * If `findCharacteristicByUUID` was called to find a single characteristic,
     * the `characteristics` array contains the single characteristic found.
     *
     * @param characteristics
     */
    onCharacteristics(characteristics: Characteristic[]): void
  }

  /**
   * A single service Characteristic.
   *
   * @url https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/network/ble/ble.md#class-characteristic
   */
  export interface Characteristic {
    connection: number
    uuid: Bytes
    service: Service
    handle: number
    name: string
    type: string
    descriptors: Descriptor[]

    /**
     * Discover all the characteristic's descriptors.
     * Discovered descriptors are returned to the `onDescriptors` callback.
     */
    discoverAllDescriptors(): void

    /**
     * Called when descriptor discovery completes.
     *
     * @param descriptors
     */
    onDescriptors(descriptors: Descriptor[]): void

    /**
     * Enable characteristic value change notifications.
     *
     * @url https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/network/ble/ble.md#enablenotifications
     */
    disableNotifications(): void
  }

  /**
   * A single Characteristic descriptor.
   *
   * @url https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/network/ble/ble.md#class-descriptor
   */
  export interface Descriptor {
    connection: number
    uuid: string
    characteristic: Characteristic
    handle: number
    name: string
    type: string

    /**
     * Read a descriptor value on demand.
     *
     * @param auth
     * @url https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/network/ble/ble.md#readvalueauth-1
     */
    readValue(auth?: number): void
  }
}

declare module 'sm' {
  import { GAP } from 'gap'

  type getAddressType = typeof GAP.AddressType

  /**
   * @url https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/network/ble/ble.md#class-sm
   */
  export const enum IOCapability {
    NoInputNoOutput = 0,
    DisplayOnly = 1,
    KeyboardOnly = 2,
    KeyboardDisplay = 3,
    DisplayYesNo = 4,
  }

  /**
   * Provides objects used to configure BLE client and server security requirements
   * and device capabilities.
   */
  export class SM {
    /**
     * Delete all bonding information and encryption keys
     * from persistent storage.
     *
     * https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/network/ble/ble.md#deleteallbondings
     */
    static deleteAllBondings(): void

    /**
     * Delete stored bonding information for the peer device with the provided
     * `address` and `addressType`.
     *
     * @param address Contains peer device Bluetooth address
     * @param addressType Peer device Bluetooth address type.
     */
    static deleteBonding(address: ArrayBuffer, addressType: getAddressType): void
  }
}

type ManufacturerSpec = {
  /**
   * The `identifier` property is a number corresponding to the
   * _Company Identifier Code_.
   */
  identifier: string | number

  /**
   * The `data` property is an array of numbers corresponding
   * to additional manufacturer specific data.
   */
  data: number[]
}

declare module 'bleserver' {
  import { GAP } from 'gap'
  import { Bytes } from 'btutils'
  import { Characteristic, Client } from 'gatt'
  import { IOCapability } from 'sm'

  type gapScanFilterPolicies =
    | typeof GAP.ScanFilterPolicy.NONE
    | typeof GAP.ScanFilterPolicy.NOT_RESOLVED_DIRECTED
    | typeof GAP.ScanFilterPolicy.WHITELIST
    | typeof GAP.ScanFilterPolicy.WHITELIST_NOT_RESOLVED_DIRECTED

  type AdvertisementData = {
    /**
     * The advertised flags value.
     */
    flags?: number
    /**
     * Array of UUID objects corresponding to _Incomplete List
     * of 16 bit Service UUIDs_
     */
    incompleteUUID16List?: Bytes[]

    /**
     * Array of UUID objects corresponding to _Complete List of
     * 16 bit Service UUIDs_
     */
    completeUUID16List?: Bytes[]

    /**
     * Array of UUID objects corresponding to _Incomplete List of
     * 128 bit Service UUIDs_
     */
    incompleteUUID128List?: Bytes[]

    /**
     * Array of UUID objects corresponding to _Complete List of
     * 128 bit Service UUIDs_
     */
    completeUUID128List?: Bytes[]

    /**
     * String corresponding to the _Shortened Local Name_.
     */
    shortName?: string

    /**
     * String corresponding to the _Complete Local Name_.
     */
    completeName?: string

    /**
     * Object corresponding to the _Manufacturer Specific Data_.
     */
    manufacturerSpecific?: ManufacturerSpec

    /**
     * Number corresponding to the TX Power Level.
     */
    txPowerLevel?: number

    /**
     * Object corresponding to the _Slave Connection Interval Range_.
     */
    connectionInterval?: {
      /**
       * A number corresponding to the minimum connection interval value.
       */
      intervalMin: number

      /**
       * A number corresponding to the maximum connection interval value.
       */
      intervalMax: number
    }

    /**
     * Array of UUID objects corresponding to the _List of 16 bit Service
     * Solicitation UUIDs_.
     */
    solicitationUUID16List?: Bytes[]

    /**
     * Array of UUID objects corresponding to the _List of 128 bit Service
     * Solicitation UUIDs_.
     */
    solicitationUUID128List?: Bytes[]

    /**
     * Object corresponding to the _Service Data - 16 bit UUID_.
     */
    serviceDataUUID16?: {
      /**
       * An object corresponding to the 16-bit Service UUID.
       */
      uuid: Bytes

      /**
       * An array of numbers corresponding to additional service data.
       */
      data: number[]
    }

    /**
     * Object corresponding to the _Service Data - 128 bit UUID_.
     */
    serviceDataUUID128?: {
      /**
       * An object corresponding to the 128-bit Service UUID.
       */
      uuid: Bytes

      /**
       * An array of numbers corresponding to additional service data.
       */
      data: number[]
    }

    /**
     * Number corresponding to the _Appearance_.
     */
    appearance?: number

    /**
     * Address object corresponding to the _Public Target Address_.
     */
    publicAddress?: Bytes

    /**
     * Address object corresponding to the _Random Target Address_.
     */
    randomAddress?: Bytes

    /**
     * Number corresponding to the _Advertising Interval_.
     */
    advertisingInterval?: number

    /**
     * Number corresponding to the _LE Role_.
     */
    role?: number

    /**
     * String corresponding to the _Uniform Resource Identifier_.
     */
    uri?: string
  }

  /**
   * Provides access to the BLE server features.
   */
  export class BLEServer {
    /**
     * Configures the device security requirements and I/O capabilities.
     */
    set securityParameters(params: {
      encryption?: boolean
      bonding?: boolean
      mitm?: boolean
      ioCapability?: IOCapability
    })

    /**
     * set/get the Bluetooth peripheral device name.
     */
    deviceName: string

    /**
     * The Bluetooth peripheral's local address as a
     * `Bytes` object.
     *
     * @url https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/network/ble/ble.md#localaddress
     */
    readonly localAddress: Bytes

    /**
     * Applications must wait for the `onReady` callback
     * before calling other `BLEServer` functions.
     */
    onReady(): void

    /**
     * Starts broadcasting advertisement and scan response packets.
     * The function is also used to configure discoverable and connectable modes.
     *
     * @param params
     * @url https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/network/ble/ble.md#startadvertisingparams
     */
    startAdvertising(params: {
      advertisingData: AdvertisementData
      connectable?: boolean
      discoverable?: boolean
      fast?: boolean
      filterPolicy?: gapScanFilterPolicies
      scanResponseData?: any
    }): void

    /**
     * Stops broadcasting Bluetooth advertisements.
     *
     * @url https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/network/ble/ble.md#stopadvertising
     */
    stopAdvertising(): void

    /**
     * Send a characteristic value change notification to the connected client.
     *
     * @param characteristic
     * @param value
     * @url https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/network/ble/ble.md#notifyvaluecharacteristic-value
     */
    notifyValue(characteristic: Characteristic, value: any): void

    /**
     * Called when a client enables notifications on the `characteristic`.
     *
     * @param characteristic
     */
    onCharacteristicNotifyEnabled(characteristic: Characteristic): void

    /**
     * Called when a client writes a service characteristic value on demand.
     *
     * @param characteristic
     * @param value
     * @url https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/network/ble/ble.md#oncharacteristicwrittencharacteristic-value
     */
    onCharacteristicWritten(characteristic: Characteristic, value: any): void

    /**
     * Called when a client reads a service characteristic value on demand.
     *
     * @param characteristic
     * @url https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/network/ble/ble.md#oncharacteristicreadcharacteristic
     */
    onCharacteristicRead(characteristic: Characteristic): Uint8Array | number[] | number | void

    /**
     * Terminate the BLE client connection.
     */
    disconnect(): void

    /**
     * Called when a client connects to the `BLEServer`.
     *
     * @param device
     * @url https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/network/ble/ble.md#ondisconnecteddevice-1
     */
    onConnected(device: Client): void

    /**
     * Called when the client connection is closed.
     *
     * @param device
     */
    onDisconnected(device: Client): void

    /**
     * Terminate any BLE client connection and release all BLE resources.
     */
    close(): void
  }

  export { BLEServer as default }
}
