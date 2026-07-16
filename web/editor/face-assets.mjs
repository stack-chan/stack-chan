export const FACE_ASSET_FORMAT = 'tech.stackchan.face'
export const FACE_ASSET_VERSION = 1
export const FACE_ASSET_MEDIA_TYPE = 'application/vnd.stackchan.face+json'
export const FACE_ASSET_KIND_SHAPE = 'shape'
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
const ROOT_FIELDS = new Set(['format', 'version', 'kind', 'name', 'emotion', 'colors', 'mouth', 'canvas', 'shape'])
const COLOR_FIELDS = new Set(['primary', 'secondary'])
const CANVAS_FIELDS = new Set(['left', 'top', 'width', 'height'])
const SHAPE_FIELDS = new Set(['eyes', 'mouth'])
const EYES_FIELDS = new Set(['left', 'right'])
const EYE_FIELDS = new Set(['x', 'y', 'radius', 'eyelidWidth', 'eyelidHeight'])
const MOUTH_FIELDS = new Set(['x', 'y', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight'])

export const DEFAULT_SHAPE_FACE = Object.freeze({
  canvas: Object.freeze({ left: 60, top: 60, width: 200, height: 120 }),
  shape: Object.freeze({
    eyes: Object.freeze({
      left: Object.freeze({ x: 30, y: 33, radius: 8, eyelidWidth: 16, eyelidHeight: 16 }),
      right: Object.freeze({ x: 170, y: 36, radius: 8, eyelidWidth: 16, eyelidHeight: 16 }),
    }),
    mouth: Object.freeze({ x: 100, y: 88, minWidth: 50, maxWidth: 90, minHeight: 8, maxHeight: 58 }),
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
  const maximumRadius = Math.min(40, canvas.width / 2, canvas.height / 2)
  const radius = clamp(eye.radius, 2, maximumRadius, fallback.radius)
  const diameter = radius * 2
  const maximumEyelidWidth = Math.min(120, canvas.width)
  const maximumEyelidHeight = Math.min(120, canvas.height)
  const eyelidWidth = clamp(eye.eyelidWidth, diameter, maximumEyelidWidth, Math.max(diameter, fallback.eyelidWidth))
  const eyelidHeight = clamp(eye.eyelidHeight, diameter, maximumEyelidHeight, Math.max(diameter, fallback.eyelidHeight))
  return {
    x: clamp(eye.x, eyelidWidth / 2, canvas.width - eyelidWidth / 2, fallback.x),
    y: clamp(eye.y, eyelidHeight / 2, canvas.height - eyelidHeight / 2, fallback.y),
    radius,
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

function validateEye(eye, canvas) {
  const maximumRadius = Math.min(40, canvas.width / 2, canvas.height / 2)
  return (
    exactFields(eye, EYE_FIELDS) &&
    validNumber(eye.radius, 2, maximumRadius) &&
    validNumber(eye.eyelidWidth, eye.radius * 2, Math.min(120, canvas.width)) &&
    validNumber(eye.eyelidHeight, eye.radius * 2, Math.min(120, canvas.height)) &&
    validNumber(eye.x, eye.eyelidWidth / 2, canvas.width - eye.eyelidWidth / 2) &&
    validNumber(eye.y, eye.eyelidHeight / 2, canvas.height - eye.eyelidHeight / 2)
  )
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
  const canvas = value.canvas
  if (
    !validNumber(canvas.left, 0, 280) ||
    !validNumber(canvas.top, 0, 200) ||
    !validNumber(canvas.width, 40, 320) ||
    !validNumber(canvas.height, 40, 240) ||
    canvas.left + canvas.width > 320 ||
    canvas.top + canvas.height > 240 ||
    !exactFields(value.shape, SHAPE_FIELDS) ||
    !exactFields(value.shape.eyes, EYES_FIELDS) ||
    !validateEye(value.shape.eyes.left, canvas) ||
    !validateEye(value.shape.eyes.right, canvas)
  ) {
    return false
  }
  const mouth = value.shape.mouth
  return (
    exactFields(mouth, MOUTH_FIELDS) &&
    validNumber(mouth.x, 0, canvas.width) &&
    validNumber(mouth.y, 0, canvas.height) &&
    validNumber(mouth.minWidth, 1, canvas.width) &&
    validNumber(mouth.maxWidth, mouth.minWidth, canvas.width) &&
    validNumber(mouth.minHeight, 1, canvas.height) &&
    validNumber(mouth.maxHeight, mouth.minHeight, canvas.height)
  )
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

export function addFaceAssetToProject(project, asset) {
  const normalized = parseFaceAsset(JSON.stringify(asset))
  const path = `assets/${normalized.name.replace(/[^\p{L}\p{N}._-]/gu, '_')}.stackchan-face.json`
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
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function number(value) {
  return Number(value.toFixed(3)).toString()
}

export function shapeFaceDefinition(asset) {
  const normalized = createFaceAsset(asset)
  const { canvas, shape } = normalized
  const eye = (value, side) =>
    `new Eye({ cx: ${number(value.x)}, cy: ${number(value.y)}, radius: ${number(value.radius)}, side: '${side}', eyelidWidth: ${number(value.eyelidWidth)}, eyelidHeight: ${number(value.eyelidHeight)} })`
  return `const _StackchanVisualShapeFace = FaceBase.template(($ = {}) => ({
  left: $.left ?? ${number(canvas.left)},
  top: $.top ?? ${number(canvas.top)},
  width: $.width ?? ${number(canvas.width)},
  height: $.height ?? ${number(canvas.height)},
  contents: [
    ${eye(shape.eyes.left, 'left')},
    ${eye(shape.eyes.right, 'right')},
    new Mouth({ cx: ${number(shape.mouth.x)}, cy: ${number(shape.mouth.y)}, minWidth: ${number(shape.mouth.minWidth)}, maxWidth: ${number(shape.mouth.maxWidth)}, minHeight: ${number(shape.mouth.minHeight)}, maxHeight: ${number(shape.mouth.maxHeight)} }),
  ],
}))`
}

export function faceAssetStatements(asset) {
  const normalized = createFaceAsset(asset)
  return [
    'robot.ui.setFace(new _StackchanVisualShapeFace({}))',
    `robot.face.setEmotion(Emotion.${normalized.emotion})`,
    `robot.face.setColor('primary', ${rgb(normalized.colors.primary).join(', ')})`,
    `robot.face.setColor('secondary', ${rgb(normalized.colors.secondary).join(', ')})`,
    `robot.face.setMouthOpen(${number(normalized.mouth)})`,
  ].join('\n')
}

function prependImport(source, statement, moduleName) {
  return source.includes(`from '${moduleName}'`) ? source : `${statement}\n${source}`
}

export function applyFaceAssetToSource(source, asset) {
  const normalized = createFaceAsset(asset)
  const marker = '  const runtime = createVisualRuntime(robot)'
  const entrypoint = 'export async function onContextCreated(robot)'
  if (!source.includes(marker) || !source.includes(entrypoint)) {
    throw new TypeError('生成コードにVisual Programmingのエントリポイントがありません')
  }

  let result = source.replace(entrypoint, `${shapeFaceDefinition(normalized)}\n\n${entrypoint}`)
  const statements = faceAssetStatements(normalized)
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n')
  result = result.replace(marker, `${marker}\n${statements}`)
  result = prependImport(result, "import { Mouth } from 'parts/mouth'", 'parts/mouth')
  result = prependImport(result, "import { Eye } from 'parts/eye'", 'parts/eye')
  result = prependImport(result, "import { FaceBase } from 'behaviors/face'", 'behaviors/face')
  result = prependImport(result, "import { Emotion } from 'face-state'", 'face-state')
  return result
}
