import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  copyEffectiveEmotionWeights,
  copyFaceState,
  copyFaceStateForDistribution,
  createEmotionWeights,
  createFaceState,
  dominantEmotion,
  Emotion,
  emotionFromName,
  emotionWeight,
  faceStatesEqual,
  quantizeBreathForPixels,
  setColorRGB,
  toColorString,
  toEmotionName,
  toPiuColorNumber,
  toPiuColorString,
  writeEmotionTransition,
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

test('FaceState distribution quantizes breath to rendered pixels', () => {
  const previous = createFaceState()
  const next = createFaceState()
  const previousDistributed = createFaceState()
  const nextDistributed = createFaceState()

  previous.breath = 0
  next.breath = 0.08
  copyFaceStateForDistribution(previous, previousDistributed, 6)
  copyFaceStateForDistribution(next, nextDistributed, 6)
  assert.equal(quantizeBreathForPixels(next.breath, 6), 0)
  assert.equal(faceStatesEqual(previousDistributed, nextDistributed), true)

  next.breath = 0.09
  copyFaceStateForDistribution(next, nextDistributed, 6)
  assert.equal(quantizeBreathForPixels(next.breath, 6), 1 / 6)
  assert.equal(faceStatesEqual(previousDistributed, nextDistributed), false)
})

test('FaceState copies continuous emotion weights without sharing mutable storage', () => {
  const face = createFaceState()
  const copied = createFaceState()
  const start = createEmotionWeights(Emotion.ANGRY)

  face.emotion = Emotion.SAD
  writeEmotionTransition(face, start, Emotion.SAD, 0.25)
  copyFaceState(face, copied)

  assert.equal(copied.emotionBlend?.active, true)
  assert.equal(emotionWeight(copied, Emotion.ANGRY), 0.75)
  assert.equal(emotionWeight(copied, Emotion.SAD), 0.25)
  assert.equal(faceStatesEqual(face, copied), true)

  if (!face.emotionBlend) throw new Error('emotion blend should exist')
  face.emotionBlend.weights[Emotion.ANGRY] = 0
  assert.equal(emotionWeight(copied, Emotion.ANGRY), 0.75)
  assert.equal(faceStatesEqual(face, copied), false)
})

test('emotion transitions finish as one-hot and legacy states remain compatible', () => {
  const face = createFaceState()
  const start = createEmotionWeights(Emotion.NEUTRAL)
  const effective = createEmotionWeights()

  face.emotion = Emotion.HAPPY
  writeEmotionTransition(face, start, Emotion.HAPPY, 0.5)
  assert.equal(emotionWeight(face, Emotion.NEUTRAL), 0.5)
  assert.equal(emotionWeight(face, Emotion.HAPPY), 0.5)
  assert.equal(dominantEmotion(face), Emotion.HAPPY, 'ties should prefer the requested target emotion')

  copyEffectiveEmotionWeights(face, effective)
  assert.deepEqual(effective, [0.5, 0, 0, 0.5, 0, 0, 0, 0])

  writeEmotionTransition(face, start, Emotion.HAPPY, 1)
  assert.equal(face.emotionBlend?.active, false)
  assert.equal(emotionWeight(face, Emotion.HAPPY), 1)
  assert.equal(emotionWeight(face, Emotion.NEUTRAL), 0)

  const legacy = {
    ...createFaceState(),
    emotion: Emotion.SAD,
    emotionBlend: undefined,
  }
  assert.equal(emotionWeight(legacy, Emotion.SAD), 1)
  assert.equal(dominantEmotion(legacy), Emotion.SAD)
})

test('interrupted emotion transitions can start from the current effective expression', () => {
  const face = createFaceState()
  const firstStart = createEmotionWeights(Emotion.NEUTRAL)
  const interruptedStart = createEmotionWeights()

  face.emotion = Emotion.ANGRY
  writeEmotionTransition(face, firstStart, Emotion.ANGRY, 0.4)
  copyEffectiveEmotionWeights(face, interruptedStart)

  face.emotion = Emotion.SAD
  writeEmotionTransition(face, interruptedStart, Emotion.SAD, 0)
  assert.equal(emotionWeight(face, Emotion.NEUTRAL), 0.6)
  assert.equal(emotionWeight(face, Emotion.ANGRY), 0.4)
  assert.equal(emotionWeight(face, Emotion.SAD), 0)

  writeEmotionTransition(face, interruptedStart, Emotion.SAD, 0.5)
  assert.equal(emotionWeight(face, Emotion.NEUTRAL), 0.3)
  assert.equal(emotionWeight(face, Emotion.ANGRY), 0.2)
  assert.equal(emotionWeight(face, Emotion.SAD), 0.5)
})
