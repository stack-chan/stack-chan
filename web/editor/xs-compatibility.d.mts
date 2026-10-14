export const XS_ARCHIVE_VERSION_RANGE: readonly [number, number, number, number]
export function xsArchiveVersionRangeForFirmware(firmwareVersion: unknown): readonly [number, number, number, number] | null
export function isXsVersionCompatible(version: unknown, range: unknown): boolean
