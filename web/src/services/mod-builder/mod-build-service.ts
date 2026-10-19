import { isXsArchive, manifestForProjectAssets, xsArchiveVersion } from '../../../editor/mod-builder.mjs'
import { assetBytes } from '../../../editor/project-format.mjs'

import { type ProjectAsset, type VisualProject } from '@/features/project-editor/project-types'
import { type ModBuildWorkerRequest, type ModBuildWorkerResponse } from '@/services/mod-builder/mod-build-protocol'

export type ModBuildResult = {
  archive: Uint8Array
  xsVersion: number[] | null
  elapsedMs: number
}

async function buildArchiveInWorker(
  request: ModBuildWorkerRequest,
  onLog: (message: string) => void,
  signal?: AbortSignal
) {
  signal?.throwIfAborted()
  const worker = new Worker(new URL('./mod-build.worker.ts', import.meta.url), {
    type: 'module',
    name: 'stackchan-mod-builder',
  })
  let abort: (() => void) | undefined
  try {
    return await new Promise<Uint8Array>((resolve, reject) => {
      abort = () => reject(new DOMException('Build cancelled', 'AbortError'))
      signal?.addEventListener('abort', abort, { once: true })
      worker.addEventListener('message', (event: MessageEvent<ModBuildWorkerResponse>) => {
        if (event.data.type === 'log') {
          onLog(event.data.message)
        } else if (event.data.type === 'success') {
          resolve(new Uint8Array(event.data.archive))
        } else {
          const error = new Error(event.data.error.message)
          error.name = event.data.error.name
          error.stack = event.data.error.stack
          reject(error)
        }
      })
      worker.addEventListener('error', (event) => {
        reject(event.error ?? new Error(event.message || 'MOD build worker failed'))
      })
      worker.postMessage(
        request,
        request.files.map((file) => file.bytes)
      )
    })
  } finally {
    if (abort) signal?.removeEventListener('abort', abort)
    worker.terminate()
  }
}

export async function buildVisualProjectMod({
  project,
  source,
  onLog,
  signal,
}: {
  project: VisualProject
  source: string
  onLog: (message: string) => void
  signal?: AbortSignal
}): Promise<ModBuildResult> {
  const startedAt = performance.now()
  const embeddedAssets = project.settings.embedAssets ? project.assets : []
  const files = embeddedAssets.map((asset: ProjectAsset) => {
    const bytes = Uint8Array.from(assetBytes(asset))
    return {
      path: asset.path,
      bytes: bytes.buffer,
    }
  })
  const archive = await buildArchiveInWorker(
    {
      type: 'build',
      modJs: source,
      name: project.name,
      manifest: manifestForProjectAssets(embeddedAssets),
      files,
    },
    onLog,
    signal
  )
  if (!isXsArchive(archive)) {
    throw new Error('生成されたファイルがXSアーカイブではありません')
  }
  return {
    archive,
    xsVersion: xsArchiveVersion(archive),
    elapsedMs: performance.now() - startedAt,
  }
}
