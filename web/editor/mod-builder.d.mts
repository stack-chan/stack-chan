export const DEFAULT_TOOLS_VERSION: string

export type ProjectFile = {
  path: string
  bytes: Uint8Array
}

export type ProjectAsset = {
  path: string
}

export type ModManifest = {
  modules: Record<string, readonly string[]>
  resources?: Record<string, readonly string[]>
}

export const DEFAULT_MOD_MANIFEST: ModManifest

export type ModToolsFileSystem = {
  mkdirTree(path: string): void
  writeFile(path: string, data: string | Uint8Array): void
  readFile(path: string): Uint8Array
  readdir(path: string): string[]
  stat(path: string): { mode: number }
  isDir(mode: number): boolean
  chdir(path: string): void
}

export type ModToolsModule = {
  ENV: Record<string, string>
  FS: ModToolsFileSystem
  callMain(argv: string[]): number
}

export type ModToolsFactory = (...args: never[]) => unknown

export type BuildModArchiveOptions = {
  modJs: string
  manifest?: ModManifest
  name?: string
  files?: readonly ProjectFile[]
  onLog?: (message: string) => void
}

export function manifestForProjectAssets(assets?: readonly ProjectAsset[]): ModManifest
export function buildDirectoryName(name: string): string
export function detectToolsVersionMismatch(logLines: readonly string[]): string | null
export function findFileWithSuffix(paths: readonly string[], suffix: string): string | undefined
export function buildModArchive(createTools: ModToolsFactory, options: BuildModArchiveOptions): Promise<Uint8Array>
export function isXsArchive(bytes: Uint8Array | null | undefined): boolean
export function xsArchiveVersion(bytes: Uint8Array): number[] | null
