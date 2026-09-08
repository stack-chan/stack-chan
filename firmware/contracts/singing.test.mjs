import assert from 'node:assert/strict'
import { test } from 'node:test'
import { singingMoraToKoe, singingScoreToKoe } from './singing.js'

test('singingMoraToKoe converts hiragana, katakana, yoon, moraic n, and long vowels', () => {
  assert.equal(singingMoraToKoe('き'), 'ki')
  assert.equal(singingMoraToKoe('キャ'), 'kya')
  assert.equal(singingMoraToKoe('デャ'), 'dya')
  assert.equal(singingMoraToKoe('ウォ'), 'o')
  assert.equal(singingMoraToKoe('ヰ'), 'i')
  assert.equal(singingMoraToKoe('ん'), 'n')
  assert.equal(singingMoraToKoe('ー', 'ko'), 'o')
  assert.throws(() => singingMoraToKoe('ー'), /前には母音/)
  assert.throws(() => singingMoraToKoe('きら'), /かな1モーラ/)
  assert.throws(() => singingMoraToKoe('っ'), /かな1モーラ/)
})

test('singingScoreToKoe converts tempo and note triples into exact koe notation', () => {
  assert.equal(
    singingScoreToKoe(120, [
      ['C4', 1, 'き'],
      ['C+4', 0.5, 'ラ'],
      ['G4', 2, 'ー'],
      ['R', 0.5, ''],
    ]),
    '#C4,500ki#C+4,250ra#G4,1000a#R,250'
  )
  assert.throws(() => singingScoreToKoe(120, []), /音符または休符/)
  assert.throws(() => singingScoreToKoe(120, [['C4', 1]]), /3項目/)
  assert.throws(() => singingScoreToKoe(120, [['R', 1, 'ら']]), /休符には歌詞/)
  assert.throws(() => singingScoreToKoe(120, [['H4', 1, 'ら']]), /歌唱音符/)
  assert.throws(() => singingScoreToKoe(20, [['C4', 16, 'ら']]), /20〜8000/)
})

