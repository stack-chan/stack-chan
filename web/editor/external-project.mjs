import { MAX_PROJECT_JSON_BYTES, parseVisualProject } from './project-format.mjs'

export function projectUrlFromSearch(search, pageUrl) {
  const value = new URLSearchParams(String(search ?? '')).get('project')
  if (!value) return null
  const base = new URL(pageUrl)
  const projectUrl = new URL(value, base)
  if (projectUrl.origin !== base.origin) throw new TypeError('別のサイトにあるプロジェクトは開けません')
  if (!projectUrl.pathname.endsWith('.stackchan-blocks.json')) {
    throw new TypeError('ブロックプロジェクトのURLではありません')
  }
  return projectUrl
}

export async function fetchExternalProject(projectUrl, fetcher = globalThis.fetch) {
  const response = await fetcher(projectUrl)
  if (!response.ok) throw new Error(`プロジェクトを取得できませんでした (${response.status})`)
  const declaredSize = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declaredSize) && declaredSize > MAX_PROJECT_JSON_BYTES) {
    throw new TypeError(`プロジェクトが上限 ${MAX_PROJECT_JSON_BYTES} バイトを超えています`)
  }
  return parseVisualProject(await response.text())
}
