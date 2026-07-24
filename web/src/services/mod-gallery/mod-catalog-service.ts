import { loadModCatalog, type ModArtifact, type ModDefinition } from '../../../mod-gallery/mod-definition.mjs'

export type { ModArtifact, ModDefinition } from '../../../mod-gallery/mod-definition.mjs'

const catalogUrl = new URL('./catalog.json', document.baseURI)
const ARCHIVE_FETCH_TIMEOUT_MS = 30_000

export const loadGalleryCatalog = () => loadModCatalog(catalogUrl)

export const fetchModArchive = async (
  artifact: ModArtifact,
  {
    fetcher = globalThis.fetch,
    timeoutMs = ARCHIVE_FETCH_TIMEOUT_MS,
  }: {
    fetcher?: typeof globalThis.fetch
    timeoutMs?: number
  } = {}
) => {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(
    () => controller.abort(new DOMException('MOD archive request timed out', 'TimeoutError')),
    timeoutMs
  )
  try {
    const response = await fetcher(artifact.url, { signal: controller.signal })
    if (!response.ok) throw new Error(`MODを取得できませんでした (HTTP ${response.status})`)
    return new Uint8Array(await response.arrayBuffer())
  } finally {
    globalThis.clearTimeout(timeout)
  }
}
