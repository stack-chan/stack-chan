import assert from 'node:assert/strict'
import test from 'node:test'
import { fitCaption } from './caption-layout.js'

const measure = (text) => [...text].reduce((n, c) => n + (c === 'W' ? 14 : c.charCodeAt(0) > 127 ? 18 : 8), 0)
test('keeps short two-line guidance intact', () => {
  assert.equal(fitCaption('Hold A to talk\nB: disconnect', measure, 190), 'Hold A to talk\nB: disconnect')
})
test('long captions stay within two measured lines and indicate omission', () => {
  for (const text of [
    'I found three interesting things about Stack-chan. First, it is a tiny robot.',
    'W'.repeat(160),
    '今日はスタックチャンについて調べた内容を順番にお伝えします。'.repeat(4),
  ]) {
    const result = fitCaption(text, measure, 190)
    assert.ok(result.split('\n').length <= 2)
    assert.ok(result.split('\n').every((line) => measure(line) <= 190))
    assert.ok(result.endsWith('...'))
  }
})
