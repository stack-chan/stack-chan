/** Shared by the host, browser tools and CLI. This is the host ABI generation, not an XS version. */
export const STACKCHAN_HOST_API_VERSION = 3
export const MOD_METADATA_RESOURCE = 'stackchan-mod.json'
export const MOD_METADATA_LIMIT = 16_384
export const MOD_FORMAT = 'tech.stackchan.mod'
export const MOD_SCHEMA_VERSION = 2

/** @typedef {'mod'} ModEntrypoint */
/** @typedef {{
 * schemaVersion: 1 | 2, id: string, version: string, appApiVersion: 1 | 2,
 * hostApiVersion: number, targets: readonly string[], capabilities: readonly string[],
 * optionalCapabilities: readonly string[], entrypoints: readonly ModEntrypoint[]
 * }} ModRuntimeContract */

export class ModCompatibilityError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** @param {unknown} value @param {string} label @param {boolean} [required] @returns {string[]} */
function stringList(value, label, required = false) {
  if (value === undefined && !required) return []
  if (!Array.isArray(value) || value.length > 32 || (required && value.length === 0))
    throw new ModCompatibilityError('MOD_METADATA_INVALID', `${label} must be a bounded string list`)
  const items = value.map((item) => {
    if (
      typeof item !== 'string' ||
      item.length === 0 ||
      item.length > 80 ||
      !/^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/.test(item)
    )
      throw new ModCompatibilityError('MOD_METADATA_INVALID', `Invalid ${label}`)
    return item
  })
  if (new Set(items).size !== items.length)
    throw new ModCompatibilityError('MOD_METADATA_INVALID', `Duplicate ${label}`)
  return items
}

/** Read compatibility declarations only. Gallery presentation fields remain in the same source document.
 * Schema 1 always describes legacy apps. Schema 2 makes the app and host ABI explicit.
 * @param {unknown} value @returns {Readonly<ModRuntimeContract>}
 */
export function parseModRuntimeContract(value) {
  if (!record(value) || value.format !== MOD_FORMAT || (value.schemaVersion !== 1 && value.schemaVersion !== 2))
    throw new ModCompatibilityError('MOD_METADATA_INVALID', 'Unsupported MOD metadata format or schema')
  if (typeof value.id !== 'string' || value.id.length > 128 || !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(value.id))
    throw new ModCompatibilityError('MOD_METADATA_INVALID', 'Invalid MOD id')
  if (
    typeof value.version !== 'string' ||
    value.version.length > 80 ||
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(value.version)
  )
    throw new ModCompatibilityError('MOD_METADATA_INVALID', 'Invalid MOD version')
  const appApiVersion = value.schemaVersion === 1 ? 1 : value.appApiVersion
  if (appApiVersion !== 1 && appApiVersion !== 2)
    throw new ModCompatibilityError('MOD_APP_API_UNSUPPORTED', 'Unsupported application API generation')
  if (
    value.schemaVersion === 1 &&
    (value.appApiVersion !== undefined ||
      value.hostApiVersion !== undefined ||
      value.optionalCapabilities !== undefined)
  )
    throw new ModCompatibilityError('MOD_METADATA_INVALID', 'Explicit API requirements need metadata schema 2')
  const hostApiVersion = value.schemaVersion === 1 ? 1 : value.hostApiVersion
  if (!Number.isSafeInteger(hostApiVersion) || Number(hostApiVersion) < appApiVersion)
    throw new ModCompatibilityError('MOD_METADATA_INVALID', 'Invalid minimum host API generation')
  const targets = stringList(value.targets, 'targets', true)
  const capabilities = stringList(value.capabilities, 'capabilities')
  const optionalCapabilities = stringList(value.optionalCapabilities, 'optionalCapabilities')
  if (optionalCapabilities.some((name) => !capabilities.includes(name)))
    throw new ModCompatibilityError('MOD_METADATA_INVALID', 'Optional capabilities must be declared in capabilities')
  const entries = stringList(value.entrypoints === undefined ? ['mod'] : value.entrypoints, 'entrypoints', true)
  if (entries.includes('miniapp'))
    throw new ModCompatibilityError(
      'MOD_APP_API_UNSUPPORTED',
      'Legacy miniapp archives are no longer supported. Rebuild using the SDK Piu extension and a mod entrypoint.',
    )
  if (entries.some((name) => name !== 'mod'))
    throw new ModCompatibilityError('MOD_METADATA_INVALID', 'Unsupported MOD entrypoints')
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    id: value.id,
    version: value.version,
    appApiVersion,
    hostApiVersion: Number(hostApiVersion),
    targets: Object.freeze(targets),
    capabilities: Object.freeze(capabilities),
    optionalCapabilities: Object.freeze(optionalCapabilities),
    entrypoints: Object.freeze(/** @type {ModEntrypoint[]} */ (entries)),
  })
}

/** @param {ModRuntimeContract} contract
 * @param {{hostApiVersion: number, target?: string, capabilities?: readonly string[], entrypoints?: readonly string[]}} host
 */
export function assertModCompatibility(contract, host) {
  const { entrypoints, capabilities } = host
  if (!Number.isSafeInteger(host.hostApiVersion) || host.hostApiVersion < contract.hostApiVersion)
    throw new ModCompatibilityError(
      'MOD_HOST_API_UNSUPPORTED',
      `MOD requires host API ${contract.hostApiVersion}; detected ${host.hostApiVersion}. Update the firmware before installing this MOD.`,
    )
  if (host.target !== undefined && !contract.targets.includes('portable') && !contract.targets.includes(host.target))
    throw new ModCompatibilityError('MOD_TARGET_UNSUPPORTED', `MOD does not support target ${host.target}`)
  if (
    entrypoints !== undefined &&
    (contract.entrypoints.length !== entrypoints.length ||
      contract.entrypoints.some((name) => !entrypoints.includes(name)))
  )
    throw new ModCompatibilityError('MOD_ENTRYPOINT_MISMATCH', 'MOD declarations do not match archive entrypoints')
  if (capabilities !== undefined) {
    const missing = contract.capabilities.filter(
      (name) => !contract.optionalCapabilities.includes(name) && !capabilities.includes(name),
    )
    if (missing.length)
      throw new ModCompatibilityError(
        'MOD_CAPABILITY_UNAVAILABLE',
        `MOD requires unavailable capabilities: ${missing.join(', ')}`,
      )
  }
}
