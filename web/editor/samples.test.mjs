import assert from 'node:assert/strict'
import test from 'node:test'

import { VISUAL_SAMPLES, sampleById } from './samples.mjs'
import { analyzeWorkspace } from './project-validator.mjs'

function blockTypes(block, result = []) {
  if (!block) return result
  result.push(block.type)
  for (const input of Object.values(block.inputs ?? {})) {
    blockTypes(input.block, result)
    blockTypes(input.shadow, result)
  }
  blockTypes(block.next?.block, result)
  return result
}

test('five representative samples have unique ids and buildable workspace structure', () => {
  assert.equal(VISUAL_SAMPLES.length, 5)
  assert.equal(new Set(VISUAL_SAMPLES.map((sample) => sample.id)).size, VISUAL_SAMPLES.length)
  for (const sample of VISUAL_SAMPLES) {
    const analysis = analyzeWorkspace(sample.workspace, { target: 'm5stackchan-cores3' })
    assert.equal(analysis.canBuild, true, `${sample.id}: ${JSON.stringify(analysis.diagnostics)}`)
    assert.deepEqual(analysis.diagnostics, [], `${sample.id}: no warnings in the starting point`)
  }
  const logic = sampleById('logic').workspace
  const logicTypes = logic.blocks.blocks.flatMap((block) => blockTypes(block))
  for (const type of [
    'variables_set',
    'variables_get',
    'lists_create_with',
    'lists_getIndex',
    'procedures_callnoreturn',
  ]) {
    assert.ok(logicTypes.includes(type), `logic sample must exercise ${type}`)
  }
  assert.equal(sampleById('missing'), VISUAL_SAMPLES[0])
})
