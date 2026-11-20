import createTools from '../../../editor/vendor/tools.js'
import { buildModArchive } from '../../../editor/mod-builder.mjs'
import { type ModBuildWorkerRequest, type ModBuildWorkerResponse } from '@/services/mod-builder/mod-build-protocol'

type ModBuildWorkerScope = {
  onmessage: ((event: MessageEvent<ModBuildWorkerRequest>) => void) | null
  postMessage: (message: ModBuildWorkerResponse, transfer?: Transferable[]) => void
}

const workerScope = globalThis as unknown as ModBuildWorkerScope

workerScope.onmessage = (event) => {
  if (event.data.type !== 'build') return
  void buildModArchive(createTools, {
    modJs: event.data.modJs,
    name: event.data.name,
    manifest: event.data.manifest,
    files: event.data.files.map((file) => ({
      path: file.path,
      bytes: new Uint8Array(file.bytes),
    })),
    onLog: (message) => workerScope.postMessage({ type: 'log', message }),
  })
    .then((archive) => {
      const archiveBuffer = Uint8Array.from(archive).buffer
      workerScope.postMessage({ type: 'success', archive: archiveBuffer }, [archiveBuffer])
    })
    .catch((error) => {
      const normalized = error instanceof Error ? error : new Error(String(error))
      workerScope.postMessage({
        type: 'error',
        error: {
          name: normalized.name,
          message: normalized.message,
          stack: normalized.stack,
        },
      })
    })
}
