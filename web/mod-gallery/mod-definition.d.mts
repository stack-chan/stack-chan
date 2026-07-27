export type ModArtifactSource = {
  format: 'xsa'
  path: string
  target: string
}

export type ModArtifact = ModArtifactSource & {
  url: URL
}

export type ModEntrypoint = 'mod' | 'miniapp'

export type ModDefinitionSource = {
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
  entrypoints: ModEntrypoint[]
  targets: string[]
  capabilities: string[]
  artifacts: ModArtifactSource[]
}

export type ModDefinition = Omit<ModDefinitionSource, 'artifacts'> & {
  sourceUrl: URL
  definitionUrl: URL
  artifacts: ModArtifact[]
}

export type CatalogResponse = {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export type CatalogFetcher = (url: URL) => Promise<CatalogResponse>

export const STACKCHAN_MOD_FORMAT: 'tech.stackchan.mod'
export const STACKCHAN_MOD_SCHEMA_VERSION: 1
export const STACKCHAN_MOD_TYPES: readonly ['block', 'text']
export const STACKCHAN_MOD_ENTRYPOINTS: readonly ['mod', 'miniapp']

export function validatePackagePath(value: unknown, label?: string): string
export function parseModDefinition(value: unknown): ModDefinitionSource
export function loadModCatalog(catalogUrl: string | URL, fetcher?: CatalogFetcher): Promise<ModDefinition[]>
