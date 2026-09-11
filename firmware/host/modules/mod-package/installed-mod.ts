import Resource from 'Resource'
import config from 'mc/config'
import Modules from 'modules'
import {
  assertModCompatibility,
  hostForTarget,
  MOD_METADATA_LIMIT,
  MOD_METADATA_RESOURCE,
  ModCompatibilityError,
  type ModRuntimeContract,
  parseModRuntimeContract,
} from 'stackchan-contracts/mod-package'
import TextDecoder from 'text/decoder'

/** Archive discovery and resource reading do not evaluate any MOD module. */
export function inspectInstalledMod(
  archive: readonly string[],
  readMetadata: () => ArrayBuffer | undefined,
  target: unknown = config.stackchanTarget ?? null,
): Readonly<ModRuntimeContract> | undefined {
  if (archive.length === 0) return undefined
  if (archive.includes('mod/config'))
    throw new ModCompatibilityError(
      'MOD_APP_API_UNSUPPORTED',
      'Executable mod/config has been retired. Move defaults to stackchan-mod.json settings and rebuild.',
    )
  const buffer = readMetadata()
  if (!buffer) throw new ModCompatibilityError('MOD_METADATA_MISSING', 'Rebuild the MOD with stackchan-mod.json')
  if (buffer.byteLength > MOD_METADATA_LIMIT)
    throw new ModCompatibilityError('MOD_METADATA_INVALID', 'MOD metadata is too large')
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer))
  } catch {
    throw new ModCompatibilityError('MOD_METADATA_INVALID', 'MOD metadata is not valid UTF-8 JSON')
  }
  const contract = parseModRuntimeContract(value)
  assertModCompatibility(contract, {
    ...hostForTarget(target),
    entrypoints: archive.filter((name) => name === 'mod' || name === 'miniapp'),
  })
  return contract
}

export default function verifyInstalledMod(): Readonly<ModRuntimeContract> | undefined {
  // Do not cache an empty archive during preload: the runtime installs it later.
  return inspectInstalledMod(Modules.archive, () => {
    if (!Resource.exists(MOD_METADATA_RESOURCE)) return undefined
    const resource = new Resource(MOD_METADATA_RESOURCE)
    if (resource.byteLength > MOD_METADATA_LIMIT)
      throw new ModCompatibilityError('MOD_METADATA_INVALID', 'MOD metadata is too large')
    return resource.slice(0)
  })
}
