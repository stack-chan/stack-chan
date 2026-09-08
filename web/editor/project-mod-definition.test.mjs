import assert from 'node:assert/strict'
import test from 'node:test'
import { parseModDefinition } from '../mod-gallery/mod-definition.mjs'
import { createVisualProject, projectFileName } from './project-format.mjs'
import { createVisualModDefinition } from './project-mod-definition.mjs'
import { analyzeWorkspace } from './project-validator.mjs'
import { profileFor } from './capabilities.mjs'

test('editor metadata comes from the same workspace capability analysis as deployment', () => {
  for (const type of ['stackchan_light_on', 'stackchan_say']) {
    const project = createVisualProject({
      name: '公開前のMOD',
      target: 'm5stackchan-cores3',
      workspace: { blocks: { blocks: [{ type: 'stackchan_on_start', inputs: { DO: { block: { type } } } }] } },
    })
    const definition = parseModDefinition(createVisualModDefinition(project))
    const { requirements } = analyzeWorkspace(project.workspace, { target: project.target })
    assert.ok(requirements.length > 0)
    assert.deepEqual(definition.capabilities, requirements)
    assert.equal(definition.source.path, projectFileName(project))
    assert.ok(definition.targets.includes(project.target))
    assert.equal(
      definition.targets.includes('simulator'),
      requirements.every((name) => profileFor('simulator').capabilities.includes(name))
    )
    assert.equal(definition.appApiVersion, 2)
    assert.equal(definition.hostApiVersion, 8)
    assert.equal(createVisualModDefinition(project).id, definition.id)
  }
})
