import { compile } from '../../firmware/tools/avatar-dsl/compiler/compile.js'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { createRuntime } from './runtime/index.js'

// Shared compiler acceptance gate for PR725's function-call validation fix.
// Do not duplicate that validation in the editor or repair invalid bytecode.
const runtime = await createRuntime({ wasmBytes: readFileSync(new URL('./runtime/avds.wasm', import.meta.url)) })
const cases = [
  ['missing argument', 'fn f(a) end fn draw() f() end'],
  ['extra argument', 'fn f(a) end fn draw() f(3,4) end'],
  ['void helper as value', 'fn f() fill_rect(0,0,1,1,primary) end fn draw() let x=f() fill_rect(0,0,x,1,primary) end'],
  ['void builtin as value', 'fn draw() let x=fill_rect(0,0,1,1,primary) fill_rect(0,0,x,1,primary) end', false],
]
const results = cases.map(([name, source, requireCompiler = true]) => {
  const requiredStage = requireCompiler ? 'compiler' : 'compiler or native VM'
  try {
    const bytecode = compile(source)
    try {
      runtime.run(bytecode)
      return { name, requiredStage, rejected: false, stage: 'accepted' }
    } catch (error) {
      return { name, requiredStage, rejected: true, stage: 'native VM', diagnostic: error.message }
    }
  } catch (error) {
    return { name, requiredStage, rejected: true, stage: 'compiler', diagnostic: error.message }
  }
})
const evidence = {
  passed: results.every(
    (result) => result.rejected && (result.requiredStage !== 'compiler' || result.stage === 'compiler')
  ),
  results,
}
const output = new URL('./.test-output/', import.meta.url)
mkdirSync(output, { recursive: true })
writeFileSync(new URL('compiler-acceptance.json', output), JSON.stringify(evidence, null, 2))
console.log(JSON.stringify(evidence, null, 2))
if (!evidence.passed) process.exitCode = 1
