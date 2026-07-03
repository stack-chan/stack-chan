import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  copyFaceState,
  createFaceState,
  Emotion,
  emotionFromName,
  setColorRGB,
  toColorString,
  toEmotionName,
  toPiuColorNumber,
  toPiuColorString,
} from './face-state.js'

test('FaceState uses plain mutable objects with numeric emotion and ColorRGB theme state', () => {
  const face = createFaceState()

  assert.equal(typeof face, 'object')
  assert.equal(face.mouth.open, 0)
  assert.equal(face.emotion, Emotion.NEUTRAL)
  assert.equal('pad0' in face, false)
  assert.equal('pad' in face.theme.primary, false)
  assert.equal(toEmotionName(Emotion.HAPPY), 'HAPPY')
  assert.equal(emotionFromName('happy'), Emotion.HAPPY)

  setColorRGB(face.theme.primary, 0x12, 0x34, 0x56)
  setColorRGB(face.theme.secondary, 0xab, 0xcd, 0xef)
  assert.equal(toPiuColorNumber(face.theme.primary), 0x123456)
  assert.equal(toPiuColorString(toPiuColorNumber(face.theme.primary)), '#123456')
  assert.equal(toColorString(face.theme.secondary), '#abcdef')

  const copied = createFaceState()
  copyFaceState(face, copied)
  assert.equal(copied.emotion, face.emotion)
  assert.equal(toPiuColorNumber(copied.theme.primary), 0x123456)
  assert.equal(toPiuColorNumber(copied.theme.secondary), 0xabcdef)
})
