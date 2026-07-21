import assert from 'node:assert/strict'
import test from 'node:test'

import { createFaceAsset } from '../editor/face-assets.mjs'
import {
  FACE_EDITOR_CONTEXT_STORAGE_KEY,
  FACE_EDITOR_DRAFT_STORAGE_KEY,
  FACE_EDITOR_STAGING_STORAGE_KEY,
  clearFaceEditContext,
  clearStagedFaceTransfer,
  loadFaceDraft,
  loadFaceEditContext,
  loadStagedFaceTransfer,
  saveFaceDraft,
  saveFaceEditContext,
  stageFaceTransfer,
} from './face-editor-storage.mjs'

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

test('face editor draft storage round-trips the latest normalized Face asset', () => {
  const storage = memoryStorage()
  const asset = createFaceAsset({ name: '下書きFace', emotion: 'HAPPY' })

  saveFaceDraft(asset, storage)

  assert.equal(loadFaceDraft(storage).name, '下書きFace')
  assert.equal(loadFaceDraft(storage).emotion, 'HAPPY')
  assert.ok(storage.getItem(FACE_EDITOR_DRAFT_STORAGE_KEY))

  storage.setItem(FACE_EDITOR_DRAFT_STORAGE_KEY, '{broken')
  assert.throws(() => loadFaceDraft(storage), /JSON|解析/)
})

test('project edit context and staging retain the originating project and stable asset path', () => {
  const storage = memoryStorage()
  const original = createFaceAsset({ name: '元の顔' })
  const edited = createFaceAsset({ name: '変更後の名前', emotion: 'HOT' })
  const edit = { projectId: 'project-1234', assetPath: 'assets/original.stackchan-face.json' }

  saveFaceEditContext(original, edit, storage)
  assert.deepEqual(loadFaceEditContext(storage).edit, edit)
  assert.equal(loadFaceEditContext(storage).asset.name, '元の顔')

  stageFaceTransfer(edited, loadFaceEditContext(storage).edit, storage)
  assert.deepEqual(loadStagedFaceTransfer(storage).edit, edit)
  assert.equal(loadStagedFaceTransfer(storage).asset.name, '変更後の名前')

  clearFaceEditContext(storage)
  clearStagedFaceTransfer(storage)
  assert.equal(storage.getItem(FACE_EDITOR_CONTEXT_STORAGE_KEY), null)
  assert.equal(storage.getItem(FACE_EDITOR_STAGING_STORAGE_KEY), null)
})

test('staging accepts a legacy raw Face asset and rejects malformed edit identities', () => {
  const storage = memoryStorage()
  const asset = createFaceAsset({ name: '旧受け渡し' })
  storage.setItem(FACE_EDITOR_STAGING_STORAGE_KEY, JSON.stringify(asset))

  assert.equal(loadStagedFaceTransfer(storage).asset.name, '旧受け渡し')
  assert.equal(loadStagedFaceTransfer(storage).edit, null)
  assert.throws(
    () => saveFaceEditContext(asset, { projectId: 'bad', assetPath: '../outside.json' }, storage),
    /プロジェクトID|アセットパス/
  )
})
