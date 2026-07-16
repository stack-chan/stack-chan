export const VISUAL_PROJECT_FORMAT = 'tech.stackchan.visual-project'
export const VISUAL_PROJECT_VERSION = 1
export const DEFAULT_PROJECT_NAME = 'はじめてのMOD'
export const DEFAULT_TARGET = 'm5stackchan-cores3'
export const MAX_PROJECT_JSON_BYTES = 8 * 1024 * 1024
export const MAX_ASSET_COUNT = 32
export const MAX_ASSET_BYTES = 2 * 1024 * 1024

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeProjectName(value) {
  const normalized = String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized.slice(0, 64) || DEFAULT_PROJECT_NAME
}

export function projectFileName(project) {
  const base = normalizeProjectName(project?.name).replace(/\s+/g, '-')
  return `${base}.stackchan-blocks.json`
}

function createProjectId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `visual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`
}

function normalizeProjectId(value) {
  const id = String(value ?? '').trim()
  return /^[A-Za-z0-9._-]{8,128}$/.test(id) ? id : createProjectId()
}

export function createVisualProject({
  id,
  name = DEFAULT_PROJECT_NAME,
  target = DEFAULT_TARGET,
  workspace,
  assets = [],
  settings = {},
  createdAt,
  updatedAt,
} = {}) {
  if (!isRecord(workspace)) throw new TypeError('ワークスペースが指定されていません')
  if (!Array.isArray(assets)) throw new TypeError('assetsは配列である必要があります')
  if (assets.length > MAX_ASSET_COUNT) {
    throw new TypeError(`アセット数が上限 ${MAX_ASSET_COUNT} を超えています`)
  }
  const now = new Date().toISOString()
  const normalizedAssets = assets.map(normalizeAsset)
  if (new Set(normalizedAssets.map((asset) => asset.path)).size !== normalizedAssets.length) {
    throw new TypeError('同じパスのアセットを複数登録できません')
  }
  const faceAsset = settings.faceAsset ? String(settings.faceAsset) : null
  if (faceAsset && !normalizedAssets.some((asset) => asset.path === faceAsset)) {
    throw new TypeError('起動時の顔アセットがassetsにありません')
  }
  return {
    format: VISUAL_PROJECT_FORMAT,
    version: VISUAL_PROJECT_VERSION,
    id: normalizeProjectId(id),
    name: normalizeProjectName(name),
    target: String(target || DEFAULT_TARGET),
    workspace: structuredClone(workspace),
    assets: normalizedAssets,
    settings: {
      educationalProfile: settings.educationalProfile !== false,
      embedAssets: settings.embedAssets !== false,
      faceAsset,
    },
    createdAt: createdAt ?? now,
    updatedAt: updatedAt ?? now,
  }
}

function normalizeAsset(asset, index) {
  if (!isRecord(asset)) throw new TypeError(`アセット ${index + 1} の形式が不正です`)
  const path = String(asset.path ?? '')
  const segments = path.split('/')
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    /[\u0000-\u001f:]/.test(path) ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new TypeError(`アセット ${index + 1} のパスが不正です`)
  }
  const encoding = asset.encoding === 'base64' ? 'base64' : 'utf8'
  const data = String(asset.data ?? '')
  if (encoding === 'base64' && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
    throw new TypeError(`アセット ${index + 1} のBase64が不正です`)
  }
  const padding = encoding === 'base64' ? (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0) : 0
  const estimatedBytes = encoding === 'base64' ? (data.length * 3) / 4 - padding : new TextEncoder().encode(data).length
  if (estimatedBytes > MAX_ASSET_BYTES) {
    throw new TypeError(`アセット ${index + 1} が上限 ${MAX_ASSET_BYTES} バイトを超えています`)
  }
  return {
    path,
    mediaType: String(asset.mediaType ?? 'application/octet-stream'),
    encoding,
    data,
  }
}

export function validateVisualProject(project) {
  const errors = []
  if (!isRecord(project)) return ['プロジェクトがJSONオブジェクトではありません']
  if (project.format !== VISUAL_PROJECT_FORMAT) errors.push('未対応のプロジェクト形式です')
  if (project.version !== VISUAL_PROJECT_VERSION) {
    errors.push(`未対応のプロジェクトバージョンです: ${project.version ?? 'なし'}`)
  }
  if (!isRecord(project.workspace)) errors.push('ワークスペースがありません')
  if (!Array.isArray(project.assets)) errors.push('assetsは配列である必要があります')
  if (Array.isArray(project.assets) && project.assets.length > MAX_ASSET_COUNT) {
    errors.push(`アセット数が上限 ${MAX_ASSET_COUNT} を超えています`)
  }
  if (!isRecord(project.settings)) errors.push('settingsがありません')
  if (!String(project.target ?? '').trim()) errors.push('対象機種がありません')
  return errors
}

export function parseVisualProject(text) {
  if (new TextEncoder().encode(String(text)).length > MAX_PROJECT_JSON_BYTES) {
    throw new TypeError(`プロジェクトが上限 ${MAX_PROJECT_JSON_BYTES} バイトを超えています`)
  }
  let parsed
  try {
    parsed = JSON.parse(String(text))
  } catch (error) {
    throw new TypeError(`JSONを解析できません: ${error.message}`)
  }

  // PR #538以前の保存データはBlocklyワークスペースそのものだった。
  // 読み込み時に包むことで、既存利用者のブラウザ内データを失わない。
  if (isRecord(parsed) && parsed.format === undefined && isRecord(parsed.blocks)) {
    return createVisualProject({ workspace: parsed })
  }

  const errors = validateVisualProject(parsed)
  if (errors.length) throw new TypeError(errors.join('\n'))
  return createVisualProject(parsed)
}

export function serializeVisualProject(project) {
  const errors = validateVisualProject(project)
  if (errors.length) throw new TypeError(errors.join('\n'))
  const serialized = `${JSON.stringify(project, null, 2)}\n`
  if (new TextEncoder().encode(serialized).length > MAX_PROJECT_JSON_BYTES) {
    throw new TypeError(`プロジェクトが上限 ${MAX_PROJECT_JSON_BYTES} バイトを超えています`)
  }
  return serialized
}

export function assetBytes(asset) {
  if (asset.encoding === 'base64') {
    const binary = globalThis.atob ? globalThis.atob(asset.data) : Buffer.from(asset.data, 'base64').toString('binary')
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  }
  return new TextEncoder().encode(asset.data)
}
