import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  copyFaceState,
  createFaceState,
  Emotion,
  emotionFromName,
  FaceState,
  setColorRGB,
  toColorString,
  toEmotionName,
  toPiuColorNumber,
} from './face-state.js'

test('FaceState is DataView backed and uses numeric emotion and ColorRGB theme state', () => {
  const face = createFaceState()

  assert.ok(face.buffer instanceof ArrayBuffer)
  assert.equal(face.byteLength, FaceState.BYTE_LENGTH)
  assert.equal(face.emotion, Emotion.NEUTRAL)
  assert.equal(toEmotionName(Emotion.HAPPY), 'HAPPY')
  assert.equal(emotionFromName('happy'), Emotion.HAPPY)

  setColorRGB(face.theme.primary, 0x12, 0x34, 0x56)
  setColorRGB(face.theme.secondary, 0xab, 0xcd, 0xef)
  assert.equal(toPiuColorNumber(face.theme.primary), 0x123456)
  assert.equal(toColorString(face.theme.secondary), '#abcdef')

  const copied = createFaceState()
  copyFaceState(face, copied)
  assert.equal(copied.emotion, face.emotion)
  assert.equal(toPiuColorNumber(copied.theme.primary), 0x123456)
  assert.equal(toPiuColorNumber(copied.theme.secondary), 0xabcdef)
})
