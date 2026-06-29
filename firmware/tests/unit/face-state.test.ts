import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
} from '../../host/modules/ui/state/face-state.js'

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

test('UI manifests register the cdv FaceState view definition', () => {
  const header = readFileSync('host/modules/ui/state/face-state-view.h', 'utf8')
  assert.match(header, /typedef struct \{\n {2}uint8_t r;/)
  assert.match(header, /typedef struct \{\n {2}MouthState mouth;/)
  assert.match(header, /uint8_t emotion;/)

  for (const manifestPath of ['host/modules/ui/manifest.json', 'host/modules/ui/manifest_wasm.json']) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    assert.deepEqual(manifest.modules['face-state-view'], {
      source: './state/face-state-view',
      transform: 'cdv',
      json: true,
    })
  }
})

test('FaceBehavior applies breathing without reassigning coordinates on every tick', () => {
  const source = readFileSync('host/modules/ui/components/face/behaviors/face.ts', 'utf8')
  const match = source.match(/onTimeChanged\(container: PiuContainer\) \{[\s\S]*?\n {2}\}\n\n {2}onTouchEnded/)

  assert.ok(match, 'FaceBehavior.onTimeChanged should be present')
  assert.doesNotMatch(match[0], /container\.coordinates\s*=/)
  assert.match(match[0], /container\.moveBy\(0, dy\)/)
})
