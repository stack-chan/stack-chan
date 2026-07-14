import assert from 'node:assert/strict'
import test from 'node:test'

import { createVisualProject } from './project-format.mjs'
import {
  createRecoveryRecord,
  duplicateVisualProject,
  parseProjectLibrary,
  serializeProjectLibrary,
  updateProjectLibrary,
} from './project-library.mjs'

const workspace = { blocks: { languageVersion: 0, blocks: [] } }

test('recent project library replaces the same project and keeps newest first', () => {
  const first = createVisualProject({
    name: 'first',
    workspace,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })
  const second = createVisualProject({
    name: 'second',
    workspace,
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  })
  const updatedFirst = { ...first, name: 'first updated', updatedAt: '2026-01-03T00:00:00.000Z' }
  const projects = updateProjectLibrary(updateProjectLibrary(updateProjectLibrary([], first), second), updatedFirst)
  assert.deepEqual(
    projects.map((project) => project.name),
    ['first updated', 'second']
  )
  assert.deepEqual(parseProjectLibrary(serializeProjectLibrary(projects)), projects)
})

test('duplicate creates a separate project without sharing mutable state', () => {
  const source = createVisualProject({ name: 'sample', workspace })
  const copy = duplicateVisualProject(source, source.createdAt)
  assert.equal(copy.name, 'sample のコピー')
  assert.equal(copy.createdAt, source.createdAt)
  assert.notEqual(copy.id, source.id)
  copy.workspace.blocks.blocks.push({ type: 'stackchan_on_start' })
  assert.equal(source.workspace.blocks.blocks.length, 0)
})

test('corrupt libraries are ignored and raw project data can be retained for recovery', () => {
  assert.deepEqual(parseProjectLibrary('{broken'), [])
  const recovery = createRecoveryRecord('{broken', new Error('JSON error'), '2026-03-01T00:00:00.000Z')
  assert.equal(recovery.raw, '{broken')
  assert.equal(recovery.error, 'JSON error')
})
