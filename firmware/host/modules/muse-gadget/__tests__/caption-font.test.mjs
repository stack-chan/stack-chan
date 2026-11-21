import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const directory = fileURLToPath(new URL('../setup-device/', import.meta.url))
const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'))
const samples = 'こんにちは。今日は日本語で音声認識と会話の確認です。スタックチャン時計聞く話す、！？ABC0123...録音中聞き取り中…ペアリング音声を聞き取れませんでした。'

function unicodeGlyphs(font) {
  let cmap
  for (let i = 0; i < font.readUInt16BE(4); i++) {
    const table = 12 + i * 16
    if (font.toString('ascii', table, table + 4) === 'cmap') cmap = font.readUInt32BE(table + 8)
  }
  assert.notEqual(cmap, undefined, 'font needs a Unicode cmap')
  let mapping, format
  for (let i = 0; i < font.readUInt16BE(cmap + 2); i++) {
    const record = cmap + 4 + i * 8
    const platform = font.readUInt16BE(record)
    const subtable = cmap + font.readUInt32BE(record + 4)
    const kind = font.readUInt16BE(subtable)
    if ((platform === 0 || platform === 3) && (kind === 4 || kind === 12)) {
      mapping = subtable
      format = kind
    }
  }
  assert.notEqual(mapping, undefined, 'font needs a Unicode cmap')
  if (format === 12)
    return (code) => {
      for (let i = 0; i < font.readUInt32BE(mapping + 12); i++) {
        const group = mapping + 16 + i * 12,
          start = font.readUInt32BE(group)
        if (code >= start && code <= font.readUInt32BE(group + 4)) return font.readUInt32BE(group + 8) + code - start
      }
      return 0
    }
  const count = font.readUInt16BE(mapping + 6) / 2
  const ends = mapping + 14,
    starts = ends + count * 2 + 2,
    deltas = starts + count * 2,
    ranges = deltas + count * 2
  return (code) => {
    for (let i = 0; i < count; i++) {
      const start = font.readUInt16BE(starts + i * 2)
      if (code < start || code > font.readUInt16BE(ends + i * 2)) continue
      const delta = font.readInt16BE(deltas + i * 2),
        range = font.readUInt16BE(ranges + i * 2)
      if (!range) return (code + delta) & 0xffff
      const glyph = font.readUInt16BE(ranges + i * 2 + range + (code - start) * 2)
      return glyph ? (glyph + delta) & 0xffff : 0
    }
    return 0
  }
}

test('bundled caption font has Japanese glyphs in both its subset and actual font', () => {
  const candidates = Object.values(manifest.resources)
    .flat()
    .filter((resource) => typeof resource === 'object' && resource.characterFiles)
  assert.ok(candidates.length, 'a Japanese character subset must be bundled')
  const required = [...new Set(samples)]
  const supported = candidates.some((resource) => {
    const files = Array.isArray(resource.characterFiles) ? resource.characterFiles : [resource.characterFiles]
    const selected =
      files.map((file) => readFileSync(resolve(directory, file), 'utf8')).join('') + (resource.characters ?? '')
    const glyph = unicodeGlyphs(readFileSync(resolve(directory, `${resource.source}.ttf`)))
    return required.every((character) => selected.includes(character) && glyph(character.codePointAt(0)) !== 0)
  })
  assert.ok(supported, 'bundled subset and font must cover the Japanese caption samples, not only Latin')
})
