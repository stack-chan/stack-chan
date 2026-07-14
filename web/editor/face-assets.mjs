export const FACE_ASSET_FORMAT = 'tech.stackchan.face'
export const FACE_ASSET_VERSION = 1
export const FACE_ASSET_MEDIA_TYPE = 'application/vnd.stackchan.face+json'
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
const ROOT_FIELDS = new Set(['format', 'version', 'name', 'emotion', 'colors', 'mouth'])
const COLOR_FIELDS = new Set(['primary', 'secondary'])

function color(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value).toLowerCase() : fallback
}

export function createFaceAsset({
  name = 'マイフェイス',
  emotion = 'NEUTRAL',
  primary,
  secondary,
  colors = {},
  mouth = 0,
} = {}) {
  return {
    format: FACE_ASSET_FORMAT,
    version: FACE_ASSET_VERSION,
    name: String(name).trim().slice(0, 64) || 'マイフェイス',
    emotion: EMOTIONS.has(emotion) ? emotion : 'NEUTRAL',
    colors: {
      primary: color(primary ?? colors.primary, '#ffffff'),
      secondary: color(secondary ?? colors.secondary, '#202020'),
    },
    mouth: Math.min(1, Math.max(0, Number(mouth) || 0)),
  }
}

export function parseFaceAsset(text) {
  let value
  try {
    value = JSON.parse(String(text))
  } catch (error) {
    throw new TypeError(`顔アセットのJSONを解析できません: ${error.message}`)
  }
  if (value?.format !== FACE_ASSET_FORMAT || value?.version !== FACE_ASSET_VERSION) {
    throw new TypeError('未対応の顔アセット形式です')
  }
  if (Object.keys(value).some((key) => !ROOT_FIELDS.has(key))) {
    throw new TypeError('顔アセットに未対応のフィールドがあります')
  }
  if (typeof value.name !== 'string' || !value.name.trim() || [...value.name].length > 64) {
    throw new TypeError('顔アセットのnameは1文字以上64文字以下にしてください')
  }
  if (!EMOTIONS.has(value.emotion)) throw new TypeError('顔アセットのemotionが不正です')
  if (
    value.colors === null ||
    typeof value.colors !== 'object' ||
    Array.isArray(value.colors) ||
    Object.keys(value.colors).some((key) => !COLOR_FIELDS.has(key)) ||
    !/^#[0-9a-f]{6}$/i.test(value.colors.primary) ||
    !/^#[0-9a-f]{6}$/i.test(value.colors.secondary)
  ) {
    throw new TypeError('顔アセットのcolorsが不正です')
  }
  if (typeof value.mouth !== 'number' || !Number.isFinite(value.mouth) || value.mouth < 0 || value.mouth > 1) {
    throw new TypeError('顔アセットのmouthは0以上1以下にしてください')
  }
  return createFaceAsset(value)
}

function rgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

export function faceAssetStatements(asset) {
  const normalized = createFaceAsset(asset)
  return [
    `robot.face.setEmotion(Emotion.${normalized.emotion})`,
    `robot.face.setColor('primary', ${rgb(normalized.colors.primary).join(', ')})`,
    `robot.face.setColor('secondary', ${rgb(normalized.colors.secondary).join(', ')})`,
    `robot.face.setMouthOpen(${normalized.mouth})`,
  ].join('\n')
}

export function applyFaceAssetToSource(source, asset) {
  const statements = faceAssetStatements(asset)
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n')
  const marker = '  const runtime = createVisualRuntime(robot)'
  if (!source.includes(marker)) throw new TypeError('生成コードにVisual Programmingのエントリポイントがありません')
  let result = source.replace(marker, `${marker}\n${statements}`)
  if (!result.includes("from 'face-state'")) result = `import { Emotion } from 'face-state'\n\n${result}`
  return result
}
