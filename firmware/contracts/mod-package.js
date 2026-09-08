import { CAPABILITY_HOST_API_VERSIONS, isCapabilityId } from './capabilities.js'
import { isSettingKey, SETTINGS_SCHEMA, validateSetting } from './settings-schema.js'
import { targetProfile } from './targets.js'

/** Shared by the host, browser tools and CLI. This is the host ABI generation, not an XS version. */
export const STACKCHAN_HOST_API_VERSION = 10
export const MOD_METADATA_RESOURCE = 'stackchan-mod.json'
export const MOD_METADATA_LIMIT = 16_384
export const MOD_FORMAT = 'tech.stackchan.mod'
export const MOD_SCHEMA_VERSION = 2

/** @typedef {'mod'} ModEntrypoint */
/** @typedef {{
 * schemaVersion: 2, id: string, version: string, appApiVersion: 2,
 * hostApiVersion: number, targets: readonly string[], capabilities: readonly string[],
 * settings: Readonly<Record<string, string | number | undefined>>,
 * optionalCapabilities: readonly string[], entrypoints: readonly ModEntrypoint[]
 * }} ModRuntimeContract */

export class ModCompatibilityError extends Error {
  /** @param {string} code @param {string} message @param {readonly string[]} [capabilities] */
  constructor(code, message, capabilities = []) {
    super(message)
    this.code = code
    this.capabilities = Object.freeze([...capabilities])
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
 * Schema 2 declares the SDK and host ABI; retired archives must be rebuilt.
 * @param {unknown} value @returns {Readonly<ModRuntimeContract>}
 */
export function parseModRuntimeContract(value) {
  if (record(value) && value.format === MOD_FORMAT && value.schemaVersion === 1)
    throw new ModCompatibilityError(
      'MOD_APP_API_UNSUPPORTED',
      'Legacy MODs are no longer supported. Rewrite with defineApp and rebuild using metadata schema 2.',
    )
  if (!record(value) || value.format !== MOD_FORMAT || value.schemaVersion !== MOD_SCHEMA_VERSION)
    throw new ModCompatibilityError('MOD_METADATA_INVALID', 'Unsupported MOD metadata format or schema')
  if (typeof value.id !== 'string' || value.id.length > 128 || !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(value.id))
    throw new ModCompatibilityError('MOD_METADATA_INVALID', 'Invalid MOD id')
  if (
    typeof value.version !== 'string' ||
    value.version.length > 80 ||
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(value.version)
  )
    throw new ModCompatibilityError('MOD_METADATA_INVALID', 'Invalid MOD version')
  const appApiVersion = value.appApiVersion
  if (appApiVersion !== 2)
    throw new ModCompatibilityError(
      'MOD_APP_API_UNSUPPORTED',
      'This host requires app API 2. Rewrite with defineApp and rebuild the MOD.',
    )
  const hostApiVersion = value.hostApiVersion
  if (!Number.isSafeInteger(hostApiVersion) || Number(hostApiVersion) < appApiVersion)
    throw new ModCompatibilityError('MOD_METADATA_INVALID', 'Invalid minimum host API generation')
  const defaults = value.settings === undefined ? {} : value.settings
  if (!record(defaults) || Object.keys(defaults).length > 32)
    throw new ModCompatibilityError('MOD_METADATA_INVALID', 'settings must contain bounded setting defaults')
  if (Object.keys(defaults).length && Number(hostApiVersion) < 9)
    throw new ModCompatibilityError('MOD_METADATA_INVALID', 'Declarative setting defaults require host API 9')
  /** @type {Record<string, string | number | undefined>} */
  const settings = {}
  for (const [key, input] of Object.entries(defaults)) {
    if (!isSettingKey(key) || !SETTINGS_SCHEMA[key].appDefault)
      throw new ModCompatibilityError('MOD_METADATA_INVALID', `Setting ${key} is unavailable for app defaults`)
    const validated = validateSetting(key, input)
    if (validated.valid === false) throw new ModCompatibilityError('MOD_METADATA_INVALID', validated.message)
    settings[key] = validated.value
  }
  const targets = stringList(value.targets, 'targets', true)
  if (targets.some((target) => !targetProfile(target)))
    throw new ModCompatibilityError('MOD_METADATA_INVALID', 'Unknown target; use a canonical target ID or portable')
  const capabilities = stringList(value.capabilities, 'capabilities')
  const optionalCapabilities = stringList(value.optionalCapabilities, 'optionalCapabilities')
  for (const capability of capabilities) {
    if (!isCapabilityId(capability))
      throw new ModCompatibilityError('MOD_METADATA_INVALID', `Unknown capability: ${capability}`)
    if (Number(hostApiVersion) < CAPABILITY_HOST_API_VERSIONS[capability])
      throw new ModCompatibilityError(
        'MOD_METADATA_INVALID',
        `Capability ${capability} requires host API ${CAPABILITY_HOST_API_VERSIONS[capability]}`,
      )
  }
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
    settings: Object.freeze(settings),
    capabilities: Object.freeze(capabilities),
    optionalCapabilities: Object.freeze(optionalCapabilities),
    entrypoints: Object.freeze(/** @type {ModEntrypoint[]} */ (entries)),
  })
}

/** @param {ModRuntimeContract} contract
 * @param {{hostApiVersion: number, target?: string | null, capabilities?: readonly string[], entrypoints?: readonly string[]}} host
 */
export function assertModCompatibility(contract, host) {
  const { entrypoints, capabilities } = host
  if (!Number.isSafeInteger(host.hostApiVersion) || host.hostApiVersion < contract.hostApiVersion)
    throw new ModCompatibilityError(
      'MOD_HOST_API_UNSUPPORTED',
      `MOD requires host API ${contract.hostApiVersion}; detected ${host.hostApiVersion}. Update the firmware before installing this MOD.`,
    )
  if (host.target === null && !contract.targets.includes('portable'))
    throw new ModCompatibilityError(
      'MOD_TARGET_UNKNOWN',
      'Firmware board identity is unavailable. Update the host firmware before installing a board-specific MOD.',
    )
  if (host.target != null && !contract.targets.includes('portable') && !contract.targets.includes(host.target))
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
        missing,
      )
  }
}

/** Build-time compatibility; live devices and permissions are checked again before app setup.
 * @param {unknown} target @param {number} [hostApiVersion]
 */
export function hostForTarget(target, hostApiVersion = STACKCHAN_HOST_API_VERSION) {
  const profile = target === 'portable' ? undefined : targetProfile(target)
  return {
    hostApiVersion,
    target: profile ? /** @type {string} */ (target) : null,
    capabilities: profile?.capabilities,
  }
}

/** Verify a selected board against the firmware descriptor, including chips shared by several boards.
 * @param {string | null | undefined} actual @param {string} expected
 */
export function assertTargetIdentity(actual, expected) {
  if (!actual || !targetProfile(actual))
    throw new ModCompatibilityError(
      'MOD_TARGET_UNKNOWN',
      'Firmware board identity is unavailable. Update the host firmware.',
    )
  if (actual !== expected)
    throw new ModCompatibilityError(
      'MOD_TARGET_UNSUPPORTED',
      `Selected target ${expected} does not match firmware target ${actual}`,
    )
}
