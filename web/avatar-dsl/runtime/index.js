// SPDX-License-Identifier: Apache-2.0
import { createContext } from '../../../firmware/mods/examples/avatar-dsl/context.js'

export const LIMITS = Object.freeze({ bytecode: 70000, pixels: 262144, instructions: 50000, draws: 96 })
const defaultWasmURL = new URL('./avds.wasm', import.meta.url)
export async function createRuntime({ wasmURL = defaultWasmURL, wasmBytes } = {}) {
  const bytes = wasmBytes ?? (await (await fetch(wasmURL)).arrayBuffer())
  const { instance } = await WebAssembly.instantiate(bytes, {})
  const exports = instance.exports
  exports._initialize?.()
  const decoder = new TextDecoder()
  return {
    run(bytecode, context = createContext(), { instructions = 12000, draws = 96 } = {}) {
      const input = bytecode instanceof Uint8Array ? bytecode : new Uint8Array(bytecode)
      if (!input.length || input.byteLength > LIMITS.bytecode) throw new Error('AVDS: bytecode size')
      if (context.length !== 41 || !Array.from(context).every(Number.isFinite)) throw new Error('AVDS: context')
      if (
        !Number.isInteger(instructions) ||
        instructions < 1 ||
        instructions > LIMITS.instructions ||
        !Number.isInteger(draws) ||
        draws < 1 ||
        draws > LIMITS.draws
      )
        throw new Error('AVDS: budget')
      const width = context[0],
        height = context[1]
      if (
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width < 1 ||
        height < 1 ||
        width > 1024 ||
        height > 1024 ||
        width * height > LIMITS.pixels
      )
        throw new Error('AVDS: canvas resource limit')
      const memory = exports.memory.buffer
      new Uint8Array(memory, exports.web_bytes(), input.byteLength).set(input)
      new Float32Array(memory, exports.web_context(), 41).set(context)
      const error = exports.web_run(input.byteLength, instructions, draws)
      if (error) {
        const view = new Uint8Array(exports.memory.buffer),
          start = exports.web_error(error)
        let end = start
        while (view[end] && end - start < 128) end++
        throw new Error(`AVDS: ${decoder.decode(view.subarray(start, end))}`)
      }
      const plan = new Int32Array(exports.memory.buffer, exports.web_plan(), exports.web_primitives() * 9)
      const rect = (offset) => ({ x: plan[offset], y: plan[offset + 1], w: plan[offset + 2], h: plan[offset + 3] })
      const primitives = []
      for (let i = 0; i < plan.length; i += 9)
        primitives.push({ command: plan[i], clip: rect(i + 1), bounds: rect(i + 5) })
      return {
        width,
        height,
        steps: exports.web_steps(),
        primitives,
        commands: new Int32Array(exports.memory.buffer, exports.web_commands(), exports.web_count() * 8).slice(),
        pixels: new Uint8ClampedArray(exports.memory.buffer, exports.web_pixels(), width * height * 4).slice(),
      }
    },
  }
}
