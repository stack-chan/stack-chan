import { existsSync, readFileSync, statSync } from 'node:fs'
import { MOD_METADATA_LIMIT, ModCompatibilityError, parseModRuntimeContract } from '../../contracts/mod-package.js'
import { inspectModArchive } from '../../contracts/xsa-metadata.js'

const decode = (bytes) => new TextDecoder('utf-8', { fatal: true }).decode(bytes)

/** Validate what mcrun actually emitted, including an adjacent canonical declaration when supplied. */
export function verifyBuiltModArchive(archivePath, metadataPath) {
  const declarationExists = metadataPath !== undefined && existsSync(metadataPath)
  const result = inspectModArchive(readFileSync(archivePath), decode, { allowLegacy: !declarationExists })
  if (declarationExists) {
    if (statSync(metadataPath).size > MOD_METADATA_LIMIT)
      throw new ModCompatibilityError('MOD_METADATA_INVALID', 'MOD metadata is too large')
    const declared = parseModRuntimeContract(JSON.parse(decode(readFileSync(metadataPath))))
    if (JSON.stringify(declared) !== JSON.stringify(result.metadata))
      throw new ModCompatibilityError('MOD_METADATA_MISMATCH', 'Built archive metadata differs from stackchan-mod.json')
  }
  return result
}
