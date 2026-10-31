import createTools from '../editor/vendor/tools.js'
import { buildModArchive } from '../editor/mod-builder.mjs'
import nativeFaceSource from '../../firmware/mods/examples/avatar-dsl/native-face.js?raw'
import contextSource from '../../firmware/mods/examples/avatar-dsl/context.js?raw'
import fallbackUrl from '../../firmware/mods/examples/avatar-dsl/assets/default_face.avbc?url'
import { createTransferProject } from './transfer.mjs'

self.onmessage = async ({ data }) => {
  if (data.type !== 'build') return
  try {
    const response = await fetch(fallbackUrl)
    if (!response.ok) throw new Error('Default native face fallback could not be loaded')
    const project = createTransferProject({
      bytecode: data.bytecode,
      nativeFaceSource,
      contextSource,
      fallbackBytecode: await response.arrayBuffer(),
    })
    const archive = await buildModArchive(createTools, {
      ...project,
      onLog: (message) => self.postMessage({ type: 'log', message }),
    })
    const bytes = Uint8Array.from(archive).buffer
    self.postMessage({ type: 'success', archive: bytes }, [bytes])
  } catch (error) {
    self.postMessage({ type: 'error', error: String(error?.message ?? error) })
  }
}
