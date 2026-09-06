import { MOD_FORMAT, MOD_SCHEMA_VERSION } from '../../firmware/contracts/mod-package.js'
import { profileFor } from './capabilities.mjs'
import { projectFileName } from './project-format.mjs'
import { analyzeWorkspace } from './project-validator.mjs'

/** Blockly currently emits legacy hooks. Changing this generation requires changing its generator too. */
export function createVisualModDefinition(project) {
  const { requirements } = analyzeWorkspace(project.workspace, { target: project.target })
  const targets = [project.target]
  if (
    !targets.includes('simulator') &&
    requirements.every((name) => profileFor('simulator').capabilities.includes(name))
  )
    targets.push('simulator')
  const id =
    String(project.id)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/g, '') || 'project'
  return {
    format: MOD_FORMAT,
    schemaVersion: MOD_SCHEMA_VERSION,
    id: 'tech.stackchan.editor.' + id,
    version: '0.0.0',
    type: 'block',
    name: project.name,
    description: 'Stack-chan visual editor project',
    source: { path: projectFileName(project) },
    appApiVersion: 1,
    hostApiVersion: 1,
    targets,
    capabilities: requirements,
    optionalCapabilities: [],
    entrypoints: ['mod'],
  }
}
