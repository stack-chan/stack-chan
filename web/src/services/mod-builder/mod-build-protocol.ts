import { type ModManifest } from '../../../editor/mod-builder.mjs'

export type ModBuildWorkerRequest = {
  type: 'build'
  modJs: string
  name: string
  manifest: ModManifest
  files: Array<{
    path: string
    bytes: ArrayBuffer
  }>
}

export type ModBuildWorkerResponse =
  | { type: 'log'; message: string }
  | { type: 'success'; archive: ArrayBuffer }
  | {
      type: 'error'
      error: {
        name: string
        message: string
        stack?: string
      }
    }
