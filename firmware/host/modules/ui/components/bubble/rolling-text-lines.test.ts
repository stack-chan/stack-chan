import assert from 'node:assert/strict'
import test from 'node:test'
import { RollingTextLines } from './rolling-text-lines.js'

test('wraps only new text and scrolls whole rows', () => {
  const rows = new RollingTextLines({ width: 3, rows: 2, measure: () => 1 })
  assert.deepEqual(rows.append('abc'), ['abc', ''])
  assert.deepEqual(rows.append('def'), ['abc', 'def'])
  assert.deepEqual(rows.append('g'), ['def', 'g'])
  assert.deepEqual(rows.append('\n次'), ['g', '次'])
  rows.clear()
  assert.deepEqual(rows.lines, ['', ''])
})

test('uses glyph widths and preserves Unicode across updates', () => {
  let measurements = 0
  const rows = new RollingTextLines({
    width: 4,
    rows: 2,
    measure: (c) => {
      measurements++
      return c === 'a' ? 1 : 2
    },
  })
  assert.deepEqual(rows.append('a猫a🐈'), ['a猫a', '🐈'])
  assert.deepEqual(rows.append('a猫'), ['🐈a', '猫'])
  assert.equal(measurements, 3)
})

test('bounds rows even for zero-width characters and large bursts', () => {
  const rows = new RollingTextLines({ width: 1, rows: 2, measure: () => 0 })
  rows.append('x'.repeat(10000))
  assert.ok(rows.lines.every((line) => line.length <= 128))
  assert.equal(rows.lines.length, 2)
})
