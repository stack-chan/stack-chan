export const VISUAL_TRACE_PREFIX = '#stackchan '

export function parseVisualTrace(text) {
  const line = String(text).trim()
  if (!line.startsWith(VISUAL_TRACE_PREFIX)) return null
  try {
    const record = JSON.parse(line.slice(VISUAL_TRACE_PREFIX.length))
    return record.component === 'visual-programming' ? record : null
  } catch {
    return null
  }
}
