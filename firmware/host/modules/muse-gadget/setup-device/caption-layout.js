export const captionBounds = { left: 12, right: 12, bottom: 62, height: 56 }
export const captionLineWidths = [340, 292]

export function paginateCaption(value, measure, widths = captionLineWidths) {
  const paragraphs = String(value).replace(/\r/g, '').trim().split('\n')
  const pages = []
  let lines = []
  for (const paragraph of paragraphs) {
    const points = Array.from(paragraph.trim())
    let offset = 0
    while (offset < points.length) {
      const width = widths[lines.length]
      let end = 0,
        high = points.length - offset
      while (end < high) {
        const middle = Math.ceil((end + high) / 2)
        if (measure(points.slice(offset, offset + middle).join('')) <= width) end = middle
        else high = middle - 1
      }
      if (!end) end = 1
      if (offset + end < points.length) {
        for (let boundary = end - 1; boundary >= Math.floor(end / 2); boundary--) {
          if (' 、。'.includes(points[offset + boundary])) {
            end = boundary + 1
            break
          }
        }
      }
      lines.push(
        points
          .slice(offset, offset + end)
          .join('')
          .trimEnd(),
      )
      offset += end
      while (offset < points.length && /\s/.test(points[offset])) offset++
      if (lines.length === 2) {
        pages.push(lines)
        lines = []
      }
    }
  }
  if (lines.length) pages.push(lines)
  return pages
}
