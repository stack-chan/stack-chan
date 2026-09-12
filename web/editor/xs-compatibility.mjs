// Default archive range of Moddable SDK 9.5 (XS 17.8).
export const XS_ARCHIVE_VERSION_RANGE = Object.freeze([17, 7, 17, 8])

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
