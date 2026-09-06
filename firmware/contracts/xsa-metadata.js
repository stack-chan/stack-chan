import {
  assertModCompatibility,
  MOD_METADATA_LIMIT,
  MOD_METADATA_RESOURCE,
  ModCompatibilityError,
  parseModRuntimeContract,
} from './mod-package.js'

/** Inspect Moddable XS_A atoms without running any module or allocating from declared archive sizes.
 * The layout is emitted by xs/tools/xslBase.c (fxWriteArchive) in the Moddable SDK.
 * @param {Uint8Array} bytes
 * @param {(bytes: Uint8Array) => string} decodeUtf8
 * @param {{allowLegacy?: boolean}} [options] Transitional readers may accept metadata-free V1 archives.
 */
export function inspectModArchive(bytes, decodeUtf8, { allowLegacy = false } = {}) {
  /** @param {string} message @returns {never} */
  const invalid = (message) => {
    throw new ModCompatibilityError('MOD_ARCHIVE_INVALID', message)
  }
  if (!(bytes instanceof Uint8Array) || bytes.length < 20) invalid('Truncated XS archive')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  /** @param {number} offset */
  const tag = (offset) => String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
  /** @param {number} offset @param {number} end */
  const atom = (offset, end) => {
    if (offset > end - 8) invalid('Truncated XS atom')
    const size = view.getUint32(offset, false)
    if (size < 8 || size > end - offset) invalid('Invalid XS atom length')
    return { tag: tag(offset + 4), data: offset + 8, end: offset + size }
  }
  const root = atom(0, bytes.length)
  if (root.tag !== 'XS_A' || root.end !== bytes.length) invalid('Invalid XS archive header or size')
  let metadata
  let version
  const seen = new Set()
  const entrypoints = []
  for (let offset = root.data; offset < root.end; ) {
    const section = atom(offset, root.end)
    if (seen.has(section.tag)) invalid('Duplicate XS section')
    seen.add(section.tag)
    if (section.tag === 'VERS') {
      if (section.end - section.data !== 4) invalid('Invalid XS version atom')
      version = Array.from(bytes.subarray(section.data, section.data + 3))
    }
    if (section.tag === 'MODS' || section.tag === 'RSRC') {
      const names = new Set()
      for (let item = section.data; item < section.end; ) {
        const path = atom(item, section.end)
        if (path.tag !== 'PATH' || path.end - path.data > 1024) invalid('Invalid archive path')
        const zero = bytes.indexOf(0, path.data)
        if (zero < path.data || zero >= path.end) invalid('Unterminated archive path')
        let name = ''
        for (let at = path.data; at < zero; at++) name += String.fromCharCode(bytes[at])
        if (names.has(name)) invalid('Duplicate archive path')
        names.add(name)
        const payload = atom(path.end, section.end)
        if (payload.tag !== (section.tag === 'MODS' ? 'CODE' : 'DATA')) invalid('Invalid archive payload')
        if (section.tag === 'MODS') {
          if (name === 'mod') entrypoints.push('mod')
          if (name === 'miniapp') entrypoints.push('miniapp')
        } else if (name === MOD_METADATA_RESOURCE) {
          if (payload.end - payload.data > MOD_METADATA_LIMIT) invalid('MOD metadata is too large')
          try {
            metadata = parseModRuntimeContract(JSON.parse(decodeUtf8(bytes.subarray(payload.data, payload.end))))
          } catch (error) {
            if (error instanceof ModCompatibilityError) throw error
            throw new ModCompatibilityError('MOD_METADATA_INVALID', 'MOD metadata is not valid UTF-8 JSON')
          }
        }
        item = payload.end
      }
    }
    offset = section.end
  }
  if (!version || !seen.has('MODS') || !seen.has('RSRC')) invalid('Missing archive sections')
  if (!metadata && !allowLegacy)
    throw new ModCompatibilityError(
      'MOD_METADATA_MISSING',
      'Rebuild this MOD with stackchan-mod.json included as a resource',
    )
  if (metadata) assertModCompatibility(metadata, { hostApiVersion: metadata.hostApiVersion, entrypoints })
  return { metadata, version, entrypoints }
}

/** Check the downloaded artifact against its separately published declaration.
 * @param {Uint8Array} bytes @param {unknown} declaration
 * @param {(bytes: Uint8Array) => string} decodeUtf8
 */
export function inspectDeclaredModArchive(bytes, declaration, decodeUtf8) {
  const result = inspectModArchive(bytes, decodeUtf8)
  const expected = parseModRuntimeContract(declaration)
  if (JSON.stringify(result.metadata) !== JSON.stringify(expected))
    throw new ModCompatibilityError('MOD_METADATA_MISMATCH', 'Archive metadata differs from its published declaration')
  return result
}
