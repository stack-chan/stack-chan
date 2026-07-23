import { loadModCatalog } from '../../../mod-gallery/mod-definition.mjs'

export type ModArtifact = {
  format: 'xsa'
  path: string
  target: string
  url: URL
}

export type ModDefinition = {
  format: 'tech.stackchan.mod'
  schemaVersion: 1
  id: string
  version: string
  type: 'block' | 'text'
  name: string
  description: string
  author?: string
  license?: string
  source: { path: string }
  sourceUrl: URL
  definitionUrl: URL
  targets: string[]
  capabilities: string[]
  artifacts: ModArtifact[]
}

const catalogUrl = new URL('./catalog.json', document.baseURI)

export const loadGalleryCatalog = () => loadModCatalog(catalogUrl) as Promise<ModDefinition[]>

export const fetchModArchive = async (artifact: ModArtifact) => {
  const response = await fetch(artifact.url)
  if (!response.ok) throw new Error(`MODを取得できませんでした (HTTP ${response.status})`)
  return new Uint8Array(await response.arrayBuffer())
}
