// Default archive range of the bundled Moddable SDK 10.0 compiler/simulator.
export const XS_ARCHIVE_VERSION_RANGE = Object.freeze([17, 7, 17, 9])
const SDK_9_5_ARCHIVE_VERSION_RANGE = Object.freeze([17, 7, 17, 8])

/** Select the archive range of the detected firmware, preserving SDK9.5's limit. */
export function xsArchiveVersionRangeForFirmware(firmwareVersion) {
  if (typeof firmwareVersion !== 'string') return null
  if (firmwareVersion.startsWith('9.5.')) return SDK_9_5_ARCHIVE_VERSION_RANGE
  if (firmwareVersion.startsWith('10.0.')) return XS_ARCHIVE_VERSION_RANGE
  return null
}

/** Match XS fxMapArchive: patch is informational; major/minor must be in range. */
export function isXsVersionCompatible(version, range) {
  const byte = (value) => Number.isInteger(value) && value >= 0 && value <= 255
  if (!Array.isArray(version) || version.length !== 3 || !version.every(byte)) return false
  if (!Array.isArray(range) || range.length !== 4 || !range.every(byte)) return false
  const actual = (version[0] << 8) | version[1]
  const minimum = (range[0] << 8) | range[1]
  const maximum = (range[2] << 8) | range[3]
  return minimum <= actual && actual <= maximum
}
