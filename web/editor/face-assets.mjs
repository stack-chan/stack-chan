import { validateShapeFace } from 'stackchan/shape-face'

export const FACE_ASSET_FORMAT = 'tech.stackchan.face'
export const FACE_ASSET_VERSION = 1
export const FACE_ASSET_MEDIA_TYPE = 'application/vnd.stackchan.face+json'
export const FACE_ASSET_KIND_SHAPE = 'shape'
export const FACE_ASSET_EYE_SHAPES = Object.freeze(['circle', 'roundRect'])
export const FACE_ASSET_EMOTIONS = Object.freeze([
  'NEUTRAL',
  'HAPPY',
  'ANGRY',
  'SAD',
  'SLEEPY',
  'DOUBTFUL',
  'COLD',
  'HOT',
])

const EMOTIONS = new Set(FACE_ASSET_EMOTIONS)
const EYE_SHAPES = new Set(FACE_ASSET_EYE_SHAPES)
const ROOT_FIELDS = new Set(['format', 'version', 'kind', 'name', 'emotion', 'colors', 'mouth', 'canvas', 'shape'])
const COLOR_FIELDS = new Set(['primary', 'secondary'])
const CANVAS_FIELDS = new Set(['left', 'top', 'width', 'height'])
const SHAPE_FIELDS = new Set(['eyes', 'mouth'])
const EYES_FIELDS = new Set(['left', 'right'])
const CIRCLE_EYE_FIELDS = new Set(['x', 'y', 'shape', 'radius', 'eyelidWidth', 'eyelidHeight'])
const ROUND_RECT_EYE_FIELDS = new Set(['x', 'y', 'shape', 'width', 'height', 'r', 'eyelidWidth', 'eyelidHeight'])
const MOUTH_FIELDS = new Set(['visible', 'x', 'y', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight'])
const DEFAULT_ROUND_RECT_EYE = Object.freeze({ width: 16, height: 16, r: 4 })

export const DEFAULT_SHAPE_FACE = Object.freeze({
  canvas: Object.freeze({ left: 60, top: 60, width: 200, height: 120 }),
  shape: Object.freeze({
    eyes: Object.freeze({
      left: Object.freeze({ x: 30, y: 33, shape: 'circle', radius: 8, eyelidWidth: 16, eyelidHeight: 16 }),
      right: Object.freeze({ x: 170, y: 36, shape: 'circle', radius: 8, eyelidWidth: 16, eyelidHeight: 16 }),
    }),
    mouth: Object.freeze({ visible: true, x: 100, y: 88, minWidth: 50, maxWidth: 90, minHeight: 8, maxHeight: 58 }),
  }),
})

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function color(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value).toLowerCase() : fallback
}

function finite(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function clamp(value, minimum, maximum, fallback) {
  return Math.min(maximum, Math.max(minimum, finite(value, fallback)))
}

function exactFields(value, fields) {
  return isRecord(value) && Object.keys(value).every((key) => fields.has(key))
}

function validNumber(value, minimum, maximum) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
}

function normalizeEye(value, fallback, canvas) {
  const eye = isRecord(value) ? value : {}
  const shape = eye.shape === 'roundRect' ? 'roundRect' : 'circle'
  const maximumEyelidWidth = Math.min(120, canvas.width)
  const maximumEyelidHeight = Math.min(120, canvas.height)
  let irisWidth
  let irisHeight
  let geometry
  if (shape === 'roundRect') {
    const width = clamp(eye.width, 4, maximumEyelidWidth, DEFAULT_ROUND_RECT_EYE.width)
    const height = clamp(eye.height, 4, maximumEyelidHeight, DEFAULT_ROUND_RECT_EYE.height)
    const r = clamp(eye.r, 0, Math.min(width, height) / 2, DEFAULT_ROUND_RECT_EYE.r)
    irisWidth = width
    irisHeight = height
    geometry = { width, height, r }
  } else {
    const maximumRadius = Math.min(40, canvas.width / 2, canvas.height / 2)
    const radius = clamp(eye.radius, 2, maximumRadius, fallback.radius)
    irisWidth = radius * 2
    irisHeight = radius * 2
    geometry = { radius }
  }
  const eyelidWidth = clamp(eye.eyelidWidth, irisWidth, maximumEyelidWidth, Math.max(irisWidth, fallback.eyelidWidth))
  const eyelidHeight = clamp(
    eye.eyelidHeight,
    irisHeight,
    maximumEyelidHeight,
    Math.max(irisHeight, fallback.eyelidHeight)
  )
  return {
    x: clamp(eye.x, eyelidWidth / 2, canvas.width - eyelidWidth / 2, fallback.x),
    y: clamp(eye.y, eyelidHeight / 2, canvas.height - eyelidHeight / 2, fallback.y),
    shape,
    ...geometry,
    eyelidWidth,
    eyelidHeight,
  }
}

function normalizeMouth(value, fallback, canvas) {
  const mouth = isRecord(value) ? value : {}
  const minWidth = clamp(mouth.minWidth, 1, canvas.width, fallback.minWidth)
  const maxWidth = clamp(mouth.maxWidth, minWidth, canvas.width, fallback.maxWidth)
  const minHeight = clamp(mouth.minHeight, 1, canvas.height, fallback.minHeight)
  const maxHeight = clamp(mouth.maxHeight, minHeight, canvas.height, fallback.maxHeight)
  return {
    visible: mouth.visible !== false,
    x: clamp(mouth.x, 0, canvas.width, fallback.x),
    y: clamp(mouth.y, 0, canvas.height, fallback.y),
    minWidth,
    maxWidth,
    minHeight,
    maxHeight,
  }
}

export function createFaceAsset({
  name = 'マイShapeフェイス',
  emotion = 'NEUTRAL',
  primary,
  secondary,
  colors = {},
  mouth = 0,
  canvas: canvasInput = {},
  shape: shapeInput = {},
} = {}) {
  const safeColors = isRecord(colors) ? colors : {}
  const safeCanvasInput = isRecord(canvasInput) ? canvasInput : {}
  const safeShapeInput = isRecord(shapeInput) ? shapeInput : {}
  const width = clamp(safeCanvasInput.width, 40, 320, DEFAULT_SHAPE_FACE.canvas.width)
  const height = clamp(safeCanvasInput.height, 40, 240, DEFAULT_SHAPE_FACE.canvas.height)
  const canvas = {
    left: clamp(safeCanvasInput.left, 0, 320 - width, DEFAULT_SHAPE_FACE.canvas.left),
    top: clamp(safeCanvasInput.top, 0, 240 - height, DEFAULT_SHAPE_FACE.canvas.top),
    width,
    height,
  }
  const eyesInput = isRecord(safeShapeInput.eyes) ? safeShapeInput.eyes : {}
  return {
    format: FACE_ASSET_FORMAT,
    version: FACE_ASSET_VERSION,
    kind: FACE_ASSET_KIND_SHAPE,
    name: String(name).trim().slice(0, 64) || 'マイShapeフェイス',
    emotion: EMOTIONS.has(emotion) ? emotion : 'NEUTRAL',
    colors: {
      primary: color(primary ?? safeColors.primary, '#ffffff'),
      secondary: color(secondary ?? safeColors.secondary, '#202020'),
    },
    mouth: clamp(mouth, 0, 1, 0),
    canvas,
    shape: {
      eyes: {
        left: normalizeEye(eyesInput.left, DEFAULT_SHAPE_FACE.shape.eyes.left, canvas),
        right: normalizeEye(eyesInput.right, DEFAULT_SHAPE_FACE.shape.eyes.right, canvas),
      },
      mouth: normalizeMouth(safeShapeInput.mouth, DEFAULT_SHAPE_FACE.shape.mouth, canvas),
    },
  }
}

function validateShapeFaceAsset(value) {
  if (!exactFields(value, ROOT_FIELDS)) return false
  if (
    value.kind !== FACE_ASSET_KIND_SHAPE ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    [...value.name].length > 64 ||
    !EMOTIONS.has(value.emotion) ||
    !exactFields(value.colors, COLOR_FIELDS) ||
    !/^#[0-9a-f]{6}$/i.test(value.colors.primary) ||
    !/^#[0-9a-f]{6}$/i.test(value.colors.secondary) ||
    !validNumber(value.mouth, 0, 1) ||
    !exactFields(value.canvas, CANVAS_FIELDS)
  ) {
    return false
  }
  if (
    !exactFields(value.shape, SHAPE_FIELDS) ||
    !exactFields(value.shape.eyes, EYES_FIELDS) ||
    !exactFields(value.shape.mouth, MOUTH_FIELDS)
  )
    return false
  for (const eye of Object.values(value.shape.eyes)) {
    if (!exactFields(eye, eye?.shape === 'roundRect' ? ROUND_RECT_EYE_FIELDS : CIRCLE_EYE_FIELDS)) return false
  }
  try {
    validateShapeFace(value)
    return true
  } catch {
    return false
  }
}

export function parseFaceAsset(text) {
  let value
  try {
    value = JSON.parse(String(text))
  } catch (error) {
    throw new TypeError(`顔アセットのJSONを解析できません: ${error.message}`)
  }
  if (value?.format !== FACE_ASSET_FORMAT) throw new TypeError('未対応の顔アセット形式です')
  if (value.version !== FACE_ASSET_VERSION || !validateShapeFaceAsset(value)) {
    throw new TypeError('Shape顔アセットの形式または値が不正です')
  }
  return createFaceAsset(value)
}

export function addFaceAssetToProject(project, asset, { replacePath = null } = {}) {
  const normalized = parseFaceAsset(JSON.stringify(asset))
  const generatedPath = `assets/${normalized.name.replace(/[^\p{L}\p{N}._-]/gu, '_')}.stackchan-face.json`
  const path = replacePath == null ? generatedPath : String(replacePath)
  if (replacePath != null) {
    const replaced = project.assets.find((item) => item.path === path)
    if (!replaced || replaced.mediaType !== FACE_ASSET_MEDIA_TYPE) {
      throw new TypeError('更新対象の顔アセットがプロジェクトにありません')
    }
  }
  const entry = {
    path,
    mediaType: FACE_ASSET_MEDIA_TYPE,
    encoding: 'utf8',
    data: `${JSON.stringify(normalized, null, 2)}\n`,
  }
  return {
    ...project,
    assets: [...project.assets.filter((item) => item.path !== path), entry],
    settings: { ...project.settings, faceAsset: path },
  }
}

function rgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16)
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 }
}

/** Export editable data; constructing and owning Piu parts belongs to the host. */
export function shapeFaceDefinition(asset) {
  const { canvas, shape } = createFaceAsset(asset)
  return `/** @type {import('stackchan/shape-face').ShapeFace} */
const _StackchanVisualShapeFace = ${JSON.stringify({ canvas, shape }, null, 2)}`
}

export function faceAssetStatements(asset) {
  const normalized = createFaceAsset(asset)
  const emotion = normalized.emotion === 'DOUBTFUL' ? 'doubt' : normalized.emotion.toLowerCase()
  return [
    'ui(app).setShapeFace(_StackchanVisualShapeFace)',
    `app.face.setEmotion('${emotion}')`,
    `app.face.setColor('primary', ${JSON.stringify(rgb(normalized.colors.primary))})`,
    `app.face.setColor('secondary', ${JSON.stringify(rgb(normalized.colors.secondary))})`,
    `app.face.setMouthOpen(${normalized.mouth})`,
  ].join('\n')
}

export function applyFaceAssetToSource(source, asset) {
  const marker = '  setup(app) {'
  if (!source.includes(marker) || !source.includes('export default defineApp('))
    throw new TypeError('生成コードにSDKアプリのエントリポイントがありません')
  let result = source.replace('export default defineApp(', `${shapeFaceDefinition(asset)}\n\nexport default defineApp(`)
  result = result.replace(
    marker,
    marker +
      '\n' +
      faceAssetStatements(asset)
        .split('\n')
        .map((line) => '    ' + line)
        .join('\n')
  )
  if (!result.includes("from 'stackchan/extensions/ui'"))
    result = "import { ui } from 'stackchan/extensions/ui'\n" + result
  return result
}
