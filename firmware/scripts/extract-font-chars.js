import fs from 'node:fs'
import path from 'node:path'
import * as fontkit from 'fontkit'

const fontPath = process.argv[2]

if (!fontPath) {
  console.error('Usage: node extract-font-chars.js <font-file.ttf>')
  process.exit(1)
}

const resolvedFontPath = path.resolve(fontPath)

if (!fs.existsSync(resolvedFontPath)) {
  console.error(`Font file not found: ${resolvedFontPath}`)
  process.exit(1)
}

const fontDir = path.dirname(resolvedFontPath)
const fontBaseName = path.basename(resolvedFontPath, path.extname(resolvedFontPath))
const outputPath = path.join(fontDir, `${fontBaseName}-chars.txt`)

let font

try {
  font = fontkit.openSync(resolvedFontPath)
} catch (error) {
  console.error(
    `Failed to open font file: ${resolvedFontPath}\n${error instanceof Error ? error.message : String(error)}`,
  )
  process.exit(1)
}

const chars = []

for (const cp of font.characterSet) {
  // 制御文字は除外
  if (cp < 0x20) continue

  // U+D800..U+DFFF は UTF-16 のサロゲート用予約領域で、単独の文字ではない
  if (cp >= 0xd800 && cp <= 0xdfff) continue

  chars.push(String.fromCodePoint(cp))
}

fs.writeFileSync(outputPath, chars.join(''), 'utf8')

console.log(`font: ${resolvedFontPath}`)
console.log(`output: ${outputPath}`)
console.log(`chars: ${chars.length}`)
