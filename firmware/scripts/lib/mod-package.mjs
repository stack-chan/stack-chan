import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { MOD_METADATA_LIMIT, ModCompatibilityError } from '../../contracts/mod-package.js'
import { inspectDeclaredModArchive, inspectModArchive } from '../../contracts/xsa-metadata.js'

const decode = (bytes) => new TextDecoder('utf-8', { fatal: true }).decode(bytes)

/** Validate what mcrun actually emitted, including an adjacent canonical declaration when supplied. */
export function verifyBuiltModArchive(archivePath, metadataPath, manifestPath) {
  const bytes = readFileSync(archivePath)
  const candidates = [metadataPath]
  if (manifestPath) candidates.push(path.resolve(path.dirname(manifestPath), '../stackchan-mod.json'))
  for (const candidate of candidates) {
    if (!candidate || !existsSync(candidate)) continue
    if (statSync(candidate).size > MOD_METADATA_LIMIT)
      throw new ModCompatibilityError('MOD_METADATA_INVALID', 'MOD metadata is too large')
    const declaration = JSON.parse(decode(readFileSync(candidate)))
    if (
      candidate !== metadataPath &&
      (typeof declaration?.source?.path !== 'string' ||
        path.resolve(path.dirname(candidate), declaration.source.path) !== path.resolve(manifestPath))
    )
      continue
    return inspectDeclaredModArchive(bytes, declaration, decode)
  }
  return inspectModArchive(bytes, decode)
}
