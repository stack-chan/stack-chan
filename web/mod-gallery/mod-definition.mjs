export const STACKCHAN_MOD_FORMAT = 'tech.stackchan.mod'
export const STACKCHAN_MOD_SCHEMA_VERSION = 1
export const STACKCHAN_MOD_TYPES = Object.freeze(['block', 'text'])
export const STACKCHAN_MOD_ENTRYPOINTS = Object.freeze(['mod', 'miniapp'])

const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value, label, maxLength) {
  const normalized = String(value ?? '').trim()
  if (!normalized || normalized.length > maxLength) throw new TypeError(`${label}が不正です`)
  return normalized
}

function validateHttpsUrl(value, label) {
  const normalized = nonEmptyString(value, label, 2048)
  let url
  try {
    url = new URL(normalized)
  } catch {
    throw new TypeError(`${label}は絶対HTTPS URLで指定してください`)
  }
  if (url.protocol !== 'https:') throw new TypeError(`${label}は絶対HTTPS URLで指定してください`)
  return url.href
}

export function validatePackagePath(value, label = 'path') {
  const path = String(value ?? '')
  const segments = path.split('/')
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    /[\u0000-\u001f:]/.test(path) ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new TypeError(`${label}が安全な相対パスではありません`)
  }
  return path
}

function stringList(value, label, { required = false } = {}) {
  if (value === undefined && !required) return []
  if (!Array.isArray(value) || (required && value.length === 0)) throw new TypeError(`${label}が不正です`)
  const result = value.map((item) => nonEmptyString(item, label, 128))
  if (new Set(result).size !== result.length) throw new TypeError(`${label}に重複があります`)
  return result
}

function catalogDefinitionUrl(value, catalogUrl) {
  const path = String(value ?? '')
  if (!path || path.startsWith('/') || path.startsWith('//') || path.includes('\\') || /[\u0000-\u001f:]/.test(path)) {
    throw new TypeError('definitionが安全なサイト内パスではありません')
  }
  const definitionUrl = new URL(path, catalogUrl)
  if (definitionUrl.origin !== catalogUrl.origin || !definitionUrl.pathname.endsWith('/stackchan-mod.json')) {
    throw new TypeError('definitionがStack-chan MOD定義を指していません')
  }
  return definitionUrl
}

export function parseModDefinition(value) {
  if (!isRecord(value)) throw new TypeError('MOD定義がJSONオブジェクトではありません')
  if (value.format !== STACKCHAN_MOD_FORMAT) throw new TypeError('未対応のMOD定義形式です')
  if (value.schemaVersion !== STACKCHAN_MOD_SCHEMA_VERSION) {
    throw new TypeError(`未対応のMOD定義バージョンです: ${value.schemaVersion ?? 'なし'}`)
  }

  const id = nonEmptyString(value.id, 'id', 128)
  if (!ID_PATTERN.test(id)) throw new TypeError('idは逆ドメイン形式で指定してください')
  const version = nonEmptyString(value.version, 'version', 80)
  if (!VERSION_PATTERN.test(version)) throw new TypeError('versionはセマンティックバージョン形式で指定してください')
  if (!STACKCHAN_MOD_TYPES.includes(value.type)) throw new TypeError('typeはblockまたはtextで指定してください')
  if (!isRecord(value.source)) throw new TypeError('sourceがありません')

  const sourcePath = validatePackagePath(value.source.path, 'source.path')
  const sourceEntrypoint =
    value.source.entrypoint === undefined
      ? undefined
      : validatePackagePath(value.source.entrypoint, 'source.entrypoint')
  if (value.type === 'block' && !sourcePath.endsWith('.stackchan-blocks.json')) {
    throw new TypeError('block MODのsource.pathは.stackchan-blocks.jsonを指す必要があります')
  }
  if (value.type === 'block' && sourceEntrypoint !== undefined) {
    throw new TypeError('block MODではsource.entrypointを指定できません')
  }
  if (value.type === 'text' && !/(^|\/)manifest[^/]*\.json$/.test(sourcePath)) {
    throw new TypeError('text MODのsource.pathはModdable manifestを指す必要があります')
  }
  if (sourceEntrypoint !== undefined && !/\.[cm]?[jt]sx?$/.test(sourceEntrypoint)) {
    throw new TypeError('text MODのsource.entrypointはJavaScriptまたはTypeScriptを指す必要があります')
  }

  let setup
  if (value.setup !== undefined) {
    if (!isRecord(value.setup)) throw new TypeError('setupが不正です')
    setup = { url: validateHttpsUrl(value.setup.url, 'setup.url') }
  }

  const artifacts = value.artifacts === undefined ? [] : value.artifacts
  if (!Array.isArray(artifacts)) throw new TypeError('artifactsが不正です')
  const entrypoints = stringList(value.entrypoints === undefined ? ['mod'] : value.entrypoints, 'entrypoints', {
    required: true,
  })
  if (entrypoints.some((entrypoint) => !STACKCHAN_MOD_ENTRYPOINTS.includes(entrypoint))) {
    throw new TypeError('entrypointsに未対応の実行入口があります')
  }

  return {
    format: STACKCHAN_MOD_FORMAT,
    schemaVersion: STACKCHAN_MOD_SCHEMA_VERSION,
    id,
    version,
    type: value.type,
    name: nonEmptyString(value.name, 'name', 80),
    description: nonEmptyString(value.description, 'description', 400),
    ...(value.author === undefined ? {} : { author: nonEmptyString(value.author, 'author', 120) }),
    ...(value.license === undefined ? {} : { license: nonEmptyString(value.license, 'license', 80) }),
    ...(setup === undefined ? {} : { setup }),
    source: { path: sourcePath, ...(sourceEntrypoint === undefined ? {} : { entrypoint: sourceEntrypoint }) },
    entrypoints,
    targets: stringList(value.targets, 'targets', { required: true }),
    capabilities: stringList(value.capabilities, 'capabilities'),
    artifacts: artifacts.map((artifact, index) => {
      if (!isRecord(artifact) || artifact.format !== 'xsa') {
        throw new TypeError(`artifacts[${index}]が不正です`)
      }
      return {
        format: 'xsa',
        path: validatePackagePath(artifact.path, `artifacts[${index}].path`),
        target: nonEmptyString(artifact.target, `artifacts[${index}].target`, 128),
      }
    }),
  }
}

async function fetchJson(url, fetcher) {
  const response = await fetcher(url)
  if (!response.ok) throw new Error(`${url.pathname}を取得できませんでした (${response.status})`)
  return response.json()
}

export async function loadModCatalog(catalogUrl, fetcher = globalThis.fetch) {
  const resolvedCatalogUrl = new URL(catalogUrl, globalThis.location?.href ?? 'http://localhost/')
  const catalog = await fetchJson(resolvedCatalogUrl, fetcher)
  if (catalog?.format !== 'tech.stackchan.mod-catalog' || catalog.version !== 1) {
    throw new TypeError('未対応のMODカタログ形式です')
  }
  if (!Array.isArray(catalog.definitions)) throw new TypeError('カタログにdefinitionsがありません')

  const definitions = await Promise.all(
    catalog.definitions.map(async (entry) => {
      const definitionUrl = catalogDefinitionUrl(entry, resolvedCatalogUrl)
      const definition = parseModDefinition(await fetchJson(definitionUrl, fetcher))
      return {
        ...definition,
        definitionUrl,
        sourceUrl: new URL(definition.source.path, definitionUrl),
        sourceViewUrl: new URL(definition.source.entrypoint ?? definition.source.path, definitionUrl),
        ...(definition.setup === undefined ? {} : { setupUrl: new URL(definition.setup.url) }),
        artifacts: definition.artifacts.map((artifact) => ({
          ...artifact,
          url: new URL(artifact.path, definitionUrl),
        })),
      }
    })
  )
  if (new Set(definitions.map((definition) => definition.id)).size !== definitions.length) {
    throw new TypeError('カタログ内のMOD IDが重複しています')
  }
  return definitions
}
