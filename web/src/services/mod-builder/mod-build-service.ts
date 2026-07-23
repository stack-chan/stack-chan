import createTools from '../../../editor/vendor/tools.js'
import {
  buildModArchive,
  isXsArchive,
  manifestForProjectAssets,
  xsArchiveVersion,
} from '../../../editor/mod-builder.mjs'
import { assetBytes } from '../../../editor/project-format.mjs'

import { type ProjectAsset, type VisualProject } from '@/features/project-editor/project-types'

const runModBuild = buildModArchive as unknown as (
  createToolsFactory: typeof createTools,
  options: {
    modJs: string
    name: string
    manifest: unknown
    files: { path: string; bytes: Uint8Array }[]
    onLog: (message: string) => void
  }
) => Promise<Uint8Array>

export type ModBuildResult = {
  archive: Uint8Array
  xsVersion: number[] | null
  elapsedMs: number
}

export async function buildVisualProjectMod({
  project,
  source,
  onLog,
}: {
  project: VisualProject
  source: string
  onLog: (message: string) => void
}): Promise<ModBuildResult> {
  const startedAt = performance.now()
  const embeddedAssets = project.settings.embedAssets ? project.assets : []
  const archive = await runModBuild(createTools, {
    modJs: source,
    name: project.name,
    manifest: manifestForProjectAssets(embeddedAssets),
    files: embeddedAssets.map((asset: ProjectAsset) => ({
      path: asset.path,
      bytes: assetBytes(asset),
    })),
    onLog,
  })
  if (!isXsArchive(archive)) {
    throw new Error('生成されたファイルがXSアーカイブではありません')
  }
  return {
    archive,
    xsVersion: xsArchiveVersion(archive),
    elapsedMs: performance.now() - startedAt,
  }
}
