export const MAX_BALLOON_CODE_POINTS = 64

function isUnsafeCodePoint(codePoint) {
  return (
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2060 && codePoint <= 0x206f) ||
    codePoint === 0xfeff
  )
}

/** Returns a bounded display string with control and formatting characters replaced by spaces. */
export function sanitizeReceivedText(value) {
  if (typeof value !== 'string') return undefined

  const characters = []
  let truncated = false
  for (const character of value) {
    if (characters.length >= MAX_BALLOON_CODE_POINTS) {
      truncated = true
      break
    }
    const codePoint = character.codePointAt(0)
    characters.push(isUnsafeCodePoint(codePoint) ? ' ' : character)
  }

  if (truncated) characters.pop()
  const text = characters.join('').trim()
  if (text.length === 0) return undefined
  return truncated ? `${text}…` : text
}

/** Extracts and sanitizes the text field from a JSON-compatible local peer payload. */
export function extractReceivedText(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  return sanitizeReceivedText(payload.text)
}
