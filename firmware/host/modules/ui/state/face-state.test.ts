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
} from './face-state.js'

function extractMethodBlocks(source: string, methodName: string): string[] {
  const blocks: string[] = []
  const pattern = new RegExp(`${methodName}\\([^)]*\\)\\s*\\{`, 'g')
  let match: RegExpExecArray | null = pattern.exec(source)
  while (match) {
    const open = source.indexOf('{', match.index)
    let depth = 0
    for (let i = open; i < source.length; i++) {
      const ch = source[i]
      if (ch === '{') depth += 1
      if (ch === '}') depth -= 1
      if (depth === 0) {
        blocks.push(source.slice(match.index, i + 1))
        pattern.lastIndex = i + 1
        break
      }
    }
    match = pattern.exec(source)
  }
  return blocks
}

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
    assert.ok(
      manifest.resources['*-alpha'].includes('../../../reference/moddable-avatar/assets/images/emoticon'),
      `${manifestPath} should bundle the emoticon sprite atlas`,
    )
  }
})

test('FaceBehavior applies breathing without reassigning coordinates on every tick', () => {
  const source = readFileSync('host/modules/ui/components/face/behaviors/face.ts', 'utf8')
  const match = source.match(/onTimeChanged\(container: PiuContainer\) \{[\s\S]*?\n {2}\}\n\n {2}onTouchEnded/)

  assert.ok(match, 'FaceBehavior.onTimeChanged should be present')
  assert.doesNotMatch(match[0], /container\.coordinates\s*=/)
  assert.match(match[0], /container\.moveBy\(0, dy\)/)
})

test('Emoticon effects render through Port and a texture atlas', () => {
  const source = readFileSync('host/modules/ui/components/effects/emoticon.ts', 'utf8')

  assert.match(source, /\bPort\.template\(/)
  assert.match(source, /new Texture\('emoticon\.png'\)/)
  assert.doesNotMatch(source, /from 'commodetto\/outline'/)
  assert.doesNotMatch(source, /\bnew Shape\b/)
  assert.doesNotMatch(source, /\bnew Skin\b/)
  assert.doesNotMatch(source, /\bnew Style\b/)
})

test('Standard face eye and mouth render updates through Port hot paths', () => {
  const eye = readFileSync('host/modules/ui/components/face/parts/eye.ts', 'utf8')
  const mouth = readFileSync('host/modules/ui/components/face/parts/mouth.ts', 'utf8')

  assert.match(eye, /\bPort\.template\(/)
  assert.match(eye, /\.drawSkin\(/)
  assert.doesNotMatch(eye, /from 'commodetto\/outline'/)
  assert.doesNotMatch(eye, /\bdefineShapeTemplate\b/)
  assert.doesNotMatch(eye, /\bnew Shape\b/)
  assert.doesNotMatch(eye, /coordinates\s*=/)

  assert.match(mouth, /\bPort\.template\(/)
  assert.match(mouth, /\.fillColor\(/)
  assert.doesNotMatch(mouth, /\bnew Skin\b/)
  assert.doesNotMatch(mouth, /coordinates\s*=/)
})

test('Dog face accent parts render updates through Port hot paths', () => {
  for (const file of [
    'host/modules/ui/components/face/parts/dog/eyebrow.ts',
    'host/modules/ui/components/face/parts/dog/mouth.ts',
    'host/modules/ui/components/face/parts/dog/nose.ts',
  ]) {
    const source = readFileSync(file, 'utf8')
    assert.match(source, /\bPort\.template\(/, `${file} should use Port.template`)
    assert.match(source, /\.fillColor\(/, `${file} should draw through Port.fillColor`)
    assert.doesNotMatch(source, /from 'commodetto\/outline'/, `${file} should not use Outline`)
    assert.doesNotMatch(source, /\bdefineShapeTemplate\b/, `${file} should not use Shape templates`)
    assert.doesNotMatch(source, /\bnew Skin\b/, `${file} should not allocate Skin`)
    assert.doesNotMatch(source, /coordinates\s*=/, `${file} should not update coordinates`)
  }
})

test('Bubble components avoid Shape backgrounds and reuse palette resources', () => {
  const speech = readFileSync('host/modules/ui/components/bubble/speech-balloon.ts', 'utf8')
  const multirow = readFileSync('host/modules/ui/components/bubble/multirow-balloon.ts', 'utf8')

  assert.match(speech, /const bubbleSkinCache = new Map/)
  assert.match(speech, /const textStyleCache = new Map/)
  assert.match(speech, /new Texture\('bubble\.png'\)/)
  assert.match(speech, /getBubbleSkin\(bubbleColor\)/)

  assert.match(multirow, /\bnew Port\(/)
  assert.match(multirow, /\.fillColor\(/)
  assert.match(multirow, /\.invalidate\(\)/)
  assert.doesNotMatch(multirow, /from 'commodetto\/outline'/)
  assert.doesNotMatch(multirow, /\bnew Shape\b/)
})

test('UI animation hot paths do not allocate Piu skins/styles or update text each tick', () => {
  const hotPathFiles = [
    'host/modules/ui/components/status-bar/chat-status-bar.ts',
    'host/modules/ui/components/effects/emoticon.ts',
    'host/modules/ui/components/face/behaviors/face.ts',
    'host/modules/ui/components/drawer/drawer.ts',
  ]

  for (const file of hotPathFiles) {
    const source = readFileSync(file, 'utf8')
    const blocks = extractMethodBlocks(source, 'onTimeChanged')
    assert.ok(blocks.length > 0, `${file} should have an onTimeChanged hot path`)
    for (const block of blocks) {
      assert.doesNotMatch(block, /\bnew\s+(Skin|Style)\b/, `${file} should not allocate Skin/Style in onTimeChanged`)
      assert.doesNotMatch(block, /\.string\s*=/, `${file} should not update text in onTimeChanged`)
    }
  }
})
