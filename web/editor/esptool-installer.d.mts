export const PARTITION_TABLE_OFFSET: number
export const PARTITION_TABLE_SIZE: number
export const ESP_APP_HEADER_SIZE: number

export const DEVICE_OPERATION_STATUS: Readonly<{
  CANCELLED: 'cancelled'
  INSTALLED: 'installed'
  REMOVED: 'removed'
}>

export type PartitionEntry = {
  type: number
  subtype: number
  offset: number
  size: number
  label: string
}

export type FirmwareDescriptor = {
  version: string
  moddableVersion: string
  hostApiVersion: number
  projectName: string
}

export type DevicePreflightDetails = {
  chip: string
  partition: PartitionEntry
  appPartition: PartitionEntry
  firmware: FirmwareDescriptor
  archiveSize?: number
  remove?: boolean
}

export type DeviceOperationOptions = {
  onLog?: (message: string) => void
  onProgress?: (progress: number) => void
  onPrompt?: (message: string) => void
  onPreflight?: (details: DevicePreflightDetails) => boolean | Promise<boolean>
  verify?: boolean
}

export type EsptoolLoader = {
  transport?: {
    disconnect?: () => void | Promise<void>
  }
  main: (...args: unknown[]) => Promise<string>
  readFlash: (address: number, size: number, ...args: unknown[]) => Promise<Uint8Array>
  writeFlash: (options: Record<string, unknown>) => Promise<unknown>
  resetToRunApp?: () => Promise<void>
}

export type EsptoolLoaderFactory = (options: {
  port: unknown
  onLog?: (message: string) => void
}) => Promise<EsptoolLoader>

export type DeviceOperationResult = {
  status: (typeof DEVICE_OPERATION_STATUS)[keyof typeof DEVICE_OPERATION_STATUS]
  operation?: 'install' | 'remove'
  chip: string
  partition: PartitionEntry
  firmware: FirmwareDescriptor
  verified?: boolean
}

export function parsePartitionTable(bytes: Uint8Array): PartitionEntry[]
export function findXsPartition(entries: readonly PartitionEntry[]): PartitionEntry
export function findAppPartition(entries: readonly PartitionEntry[]): PartitionEntry
export function parseEspAppDescriptor(bytes: Uint8Array): FirmwareDescriptor | null
export function bytesToBinaryString(bytes: Uint8Array): string
export function xsArchiveByteLength(bytes: Uint8Array): number | null
export function equalBytes(left: Uint8Array, right: Uint8Array): boolean
export function installModToDevice(
  loaderFactory: EsptoolLoaderFactory,
  port: unknown,
  archive: Uint8Array,
  options?: DeviceOperationOptions
): Promise<DeviceOperationResult>
export function removeModFromDevice(
  loaderFactory: EsptoolLoaderFactory,
  port: unknown,
  options?: DeviceOperationOptions
): Promise<DeviceOperationResult>
export function createEsptoolLoader(options?: {
  port: unknown
  onLog?: (message: string) => void
  baudrate?: number
}): Promise<EsptoolLoader>
