import assert from 'node:assert/strict'
import test from 'node:test'
import { captionLineWidths, paginateCaption } from './caption-layout.js'
const measure = (text) => [...text].reduce((n, c) => n + (c.codePointAt(0) > 127 ? 24 : 12), 0)
test('short guidance uses at most two unscaled lines', () => {
  assert.deepEqual(paginateCaption('こんにちは', measure), [['こんにちは']])
})
test('all long Japanese text survives sequential two-line pages', () => {
  const text =
    '今日はスタックチャンの仕組みを紹介します。小さなロボットでも、さまざまな表情で会話を楽しめます。'.repeat(7)
  const pages = paginateCaption(text, measure)
  assert.ok(pages.length > 2)
  assert.equal(pages.flat().join(''), text)
  for (const lines of pages) {
    assert.ok(lines.length <= 2)
    assert.ok(lines.every((line, index) => measure(line) <= captionLineWidths[index]))
  }
})
test('wrapping preserves supplementary Unicode characters', () => {
  const text = 'こんにちは🙂お元気ですか。'.repeat(12)
  assert.equal(paginateCaption(text, measure).flat().join(''), text)
})

test('punctuation after emoji uses code-point boundaries within each measured row', () => {
  const text = `${'😀'.repeat(10)}。${'あ'.repeat(20)}`
  const measured = (line) => Array.from(line).length * 24
  const pages = paginateCaption(text, measured)
  assert.equal(pages.flat().join(''), text)
  assert.ok(pages.every((lines) => lines.every((line, index) => measured(line) <= captionLineWidths[index])))
})
