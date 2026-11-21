export function fitCaption(value, measure, width) {
  let rest = String(value).replace(/\r/g, '').trim()
  const lines = []
  while (rest && lines.length < 2) {
    const newline = rest.indexOf('\n')
    const paragraph = newline < 0 ? rest : rest.slice(0, newline)
    if (lines.length === 1) {
      if (newline < 0 && measure(rest) <= width) lines.push(rest)
      else {
        let end = 0
        while (end < paragraph.length && measure(paragraph.slice(0, end + 1) + '...') <= width) end++
        lines.push(paragraph.slice(0, end).trimEnd() + '...')
      }
      break
    }
    let end = 0
    while (end < paragraph.length && measure(paragraph.slice(0, end + 1)) <= width) end++
    if (end < paragraph.length) {
      const space = paragraph.lastIndexOf(' ', end)
      if (space > 0) end = space
    }
    if (!end && paragraph.length) end = 1
    lines.push(paragraph.slice(0, end).trimEnd())
    rest = rest.slice(end).trimStart()
  }
  return lines.join('\n')
}
