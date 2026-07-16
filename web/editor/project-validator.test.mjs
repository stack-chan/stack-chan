import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeWorkspace } from './project-validator.mjs'
import { toolboxForTarget } from './capabilities.mjs'

test('rejects an empty workspace before build', () => {
  const result = analyzeWorkspace({ blocks: { blocks: [] } })
  assert.equal(result.canBuild, false)
  assert.deepEqual(
    result.diagnostics.map((item) => item.code),
    ['VP_EMPTY']
  )
})

test('warns about a condition loop that may not stop', () => {
  const result = analyzeWorkspace({
    blocks: {
      blocks: [
        {
          id: 'start',
          type: 'stackchan_on_start',
          inputs: { DO: { block: { id: 'loop', type: 'controls_whileUntil' } } },
        },
      ],
    },
  })
  assert.equal(result.canBuild, true)
  assert.deepEqual(
    result.diagnostics.map((item) => [item.code, item.blockId]),
    [['VP_UNBOUNDED_LOOP', 'loop']]
  )
})

test('collects required capabilities from nested blocks', () => {
  const workspace = {
    blocks: {
      blocks: [
        {
          id: 'start',
          type: 'stackchan_on_start',
          inputs: { DO: { block: { id: 'led', type: 'stackchan_light_on' } } },
        },
      ],
    },
  }
  const result = analyzeWorkspace(workspace, { target: 'm5stackchan-cores3' })
  assert.equal(result.canBuild, true)
  assert.deepEqual(result.requirements, ['lighting'])
})

test('rejects capabilities unsupported by the selected profile', () => {
  const workspace = {
    blocks: {
      blocks: [
        {
          id: 'start',
          type: 'stackchan_on_start',
          inputs: { DO: { block: { id: 'led', type: 'stackchan_light_on' } } },
        },
      ],
    },
  }
  const result = analyzeWorkspace(workspace, { target: 'simulator' })
  assert.equal(result.canBuild, false)
  assert.equal(result.diagnostics[0].code, 'VP_UNSUPPORTED_CAPABILITY')
  assert.equal(result.diagnostics[0].blockId, 'led')
})

test('rejects statement blocks left outside an event', () => {
  const result = analyzeWorkspace(
    { blocks: { blocks: [{ id: 'face', type: 'stackchan_set_emotion' }] } },
    { target: 'm5stackchan-cores3' }
  )
  assert.equal(result.canBuild, false)
  assert.equal(result.diagnostics[0].code, 'VP_ORPHAN_TOP_LEVEL')
})

test('capability-aware toolbox removes unsupported hardware blocks', () => {
  const toolbox = {
    contents: [
      {
        contents: [
          { kind: 'block', type: 'stackchan_set_emotion' },
          { kind: 'block', type: 'stackchan_light_on' },
        ],
      },
    ],
  }
  const filtered = toolboxForTarget(toolbox, 'simulator')
  assert.deepEqual(
    filtered.contents[0].contents.map((entry) => entry.type),
    ['stackchan_set_emotion']
  )
})

test('warns about unused variables and permits function definitions at top level', () => {
  const workspace = {
    variables: [{ name: '回数', id: 'count' }],
    blocks: {
      blocks: [
        { id: 'helper', type: 'procedures_defnoreturn', fields: { NAME: 'おじぎ' } },
        { id: 'start', type: 'stackchan_on_start' },
      ],
    },
  }
  const result = analyzeWorkspace(workspace)
  assert.equal(result.canBuild, true)
  assert.deepEqual(
    result.diagnostics.map((item) => item.code),
    ['VP_UNUSED_VARIABLE', 'VP_UNUSED_PROCEDURE']
  )
})
