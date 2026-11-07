import { compile } from '../../firmware/tools/avatar-dsl/compiler/compile.js'
import { checkSource, MAX_BYTECODE_BYTES } from './editor-model.mjs'
import { createRuntime } from './runtime/index.js'

self.onmessage = async ({ data }) => {
  try {
    checkSource(data.source)
    const bytecode = compile(data.source)
    if (bytecode.byteLength > MAX_BYTECODE_BYTES) throw new Error('Compiled DSL exceeds 16 KiB')
    const runtime = await createRuntime()
    const result = runtime.run(bytecode, data.context)
    self.postMessage({ bytecode, result }, [bytecode])
  } catch (error) {
    self.postMessage({ error: error.message || String(error) })
  }
}
