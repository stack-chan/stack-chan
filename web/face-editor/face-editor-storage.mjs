import { parseFaceAsset } from '../editor/face-assets.mjs'

export const FACE_EDITOR_DRAFT_STORAGE_KEY = 'stackchan-face-editor-draft-v1'
export const FACE_EDITOR_CONTEXT_STORAGE_KEY = 'stackchan-face-editor-edit-context-v1'
export const FACE_EDITOR_STAGING_STORAGE_KEY = 'stackchan-face-asset-staging'

const FACE_EDITOR_TRANSFER_FORMAT = 'tech.stackchan.face-editor-transfer'
const FACE_EDITOR_TRANSFER_VERSION = 1

function parseJson(text, description) {
  try {
    return JSON.parse(String(text))
  } catch (error) {
    throw new TypeError(`${description}のJSONを解析できません: ${error.message}`)
  }
}

function normalizeEditContext(edit) {
  if (edit == null) return null
  const projectId = String(edit.projectId ?? '').trim()
  const assetPath = String(edit.assetPath ?? '')
  if (!/^[A-Za-z0-9._-]{8,128}$/.test(projectId)) {
    throw new TypeError('顔編集元のプロジェクトIDが不正です')
  }
  if (!assetPath.startsWith('assets/') || assetPath.includes('..') || assetPath.includes('\\')) {
    throw new TypeError('顔編集元のアセットパスが不正です')
  }
  return { projectId, assetPath }
}

export function createFaceEditorTransfer(asset, edit = null) {
  return {
    format: FACE_EDITOR_TRANSFER_FORMAT,
    version: FACE_EDITOR_TRANSFER_VERSION,
    asset: parseFaceAsset(JSON.stringify(asset)),
    edit: normalizeEditContext(edit),
  }
}

export function parseFaceEditorTransfer(text) {
  const value = parseJson(text, '顔エディタ受け渡しデータ')

  // Version 1 of the face editor stored a raw Face asset in the staging key.
  if (value?.format !== FACE_EDITOR_TRANSFER_FORMAT) {
    return createFaceEditorTransfer(parseFaceAsset(JSON.stringify(value)))
  }
  if (value.version !== FACE_EDITOR_TRANSFER_VERSION || value.asset == null) {
    throw new TypeError('未対応の顔エディタ受け渡し形式です')
  }
  return createFaceEditorTransfer(value.asset, value.edit)
}

export function loadFaceDraft(storage = globalThis.localStorage) {
  const stored = storage.getItem(FACE_EDITOR_DRAFT_STORAGE_KEY)
  return stored == null ? null : parseFaceAsset(stored)
}

export function saveFaceDraft(asset, storage = globalThis.localStorage) {
  const normalized = parseFaceAsset(JSON.stringify(asset))
  storage.setItem(FACE_EDITOR_DRAFT_STORAGE_KEY, JSON.stringify(normalized))
  return normalized
}

export function loadFaceEditContext(storage = globalThis.localStorage) {
  const stored = storage.getItem(FACE_EDITOR_CONTEXT_STORAGE_KEY)
  return stored == null ? null : parseFaceEditorTransfer(stored)
}

export function saveFaceEditContext(asset, edit, storage = globalThis.localStorage) {
  const transfer = createFaceEditorTransfer(asset, edit)
  storage.setItem(FACE_EDITOR_CONTEXT_STORAGE_KEY, JSON.stringify(transfer))
  return transfer
}

export function clearFaceEditContext(storage = globalThis.localStorage) {
  storage.removeItem(FACE_EDITOR_CONTEXT_STORAGE_KEY)
}

export function loadStagedFaceTransfer(storage = globalThis.localStorage) {
  const stored = storage.getItem(FACE_EDITOR_STAGING_STORAGE_KEY)
  return stored == null ? null : parseFaceEditorTransfer(stored)
}

export function stageFaceTransfer(asset, edit = null, storage = globalThis.localStorage) {
  const transfer = createFaceEditorTransfer(asset, edit)
  storage.setItem(FACE_EDITOR_STAGING_STORAGE_KEY, JSON.stringify(transfer))
  return transfer
}

export function clearStagedFaceTransfer(storage = globalThis.localStorage) {
  storage.removeItem(FACE_EDITOR_STAGING_STORAGE_KEY)
}
