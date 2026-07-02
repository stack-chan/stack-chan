import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

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

test('FaceState stays on plain objects instead of DataView-backed cdv views', () => {
  const faceState = readFileSync('host/modules/ui/state/face-state.ts', 'utf8')
  assert.doesNotMatch(faceState, /\bDataView\b/)
  assert.doesNotMatch(faceState, /\bArrayBuffer\b/)
  assert.match(faceState, /export type FaceState = \{/)
  assert.match(faceState, /export function copyFaceState/)
  assert.match(faceState, /export function faceStatesEqual/)

  for (const manifestPath of ['host/modules/ui/manifest.json', 'host/modules/ui/manifest_wasm.json']) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    assert.equal(manifest.modules['face-state-view'], undefined)
    assert.ok(
      manifest.resources['*-alpha'].includes('./assets/images/emoticon'),
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
  assert.match(source, /createBlinkMotion\(/)
  assert.match(source, /createBreathMotion\(/)
  assert.match(source, /createSaccadeMotion\(/)
  assert.match(source, /faceStatesEqual\(this\.#current, this\.#lastDistributed\)/)
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

test('Standard face keeps expressive eyes while avoiding direct path allocation in onFaceState', () => {
  const eye = readFileSync('host/modules/ui/components/face/parts/eye.ts', 'utf8')
  const mouth = readFileSync('host/modules/ui/components/face/parts/mouth.ts', 'utf8')

  assert.match(eye, /from 'commodetto\/outline'/)
  assert.match(eye, /\bdefineShapeTemplate\b/)
  assert.match(eye, /\bContainer\.template\(/)
  assert.match(eye, /path\.arc\(/)
  assert.match(eye, /case Emotion\.ANGRY:/)
  assert.match(eye, /case Emotion\.SAD:/)
  assert.match(eye, /case Emotion\.HAPPY:/)
  assert.match(eye, /case Emotion\.SLEEPY:/)
  assert.match(eye, /let eyelidOutlineCache: Map<.*> \| null = null/)
  assert.match(eye, /if \(!eyelidOutlineCache\) eyelidOutlineCache = new Map\(\)/)
  assert.match(eye, /\bquantizeUnit\(/)
  for (const block of extractMethodBlocks(eye, 'onFaceState')) {
    assert.doesNotMatch(block, /\bnew\s+(Skin|Outline\.CanvasPath)\b/)
    assert.doesNotMatch(block, /Outline\.(?:fill|stroke)\(/)
  }

  assert.match(mouth, /\bPort\.template\(/)
  assert.match(mouth, /\.fillColor\(/)
  assert.doesNotMatch(mouth, /\bnew Skin\b/)
  assert.doesNotMatch(mouth, /coordinates\s*=/)
})

test('Dog face accent parts preserve curved shapes and cache generated outlines', () => {
  const files = [
    ['host/modules/ui/components/face/parts/dog/eyebrow.ts', /path\.ellipse\(/],
    ['host/modules/ui/components/face/parts/dog/mouth.ts', /path\.bezierCurveTo\(/],
    ['host/modules/ui/components/face/parts/dog/nose.ts', /path\.quadraticCurveTo\(/],
  ] as const

  for (const [file, curvePattern] of files) {
    const source = readFileSync(file, 'utf8')
    assert.match(source, /from 'commodetto\/outline'/, `${file} should use Outline for curved accents`)
    assert.match(source, /\bdefineShapeTemplate\b/, `${file} should use Shape templates for curved accents`)
    assert.match(source, curvePattern, `${file} should preserve its original curved path primitive`)
    assert.match(source, /OutlineCache = new Map/, `${file} should cache generated outlines`)
    assert.doesNotMatch(source, /coordinates\s*=/, `${file} should not update coordinates`)
    for (const block of extractMethodBlocks(source, 'onFaceState')) {
      assert.doesNotMatch(block, /\bnew\s+(Skin|Outline\.CanvasPath)\b/, `${file} should not allocate in onFaceState`)
      assert.doesNotMatch(block, /Outline\.(?:fill|stroke)\(/, `${file} should not fill/stroke outlines in onFaceState`)
    }
  }
})

test('Bubble components avoid Shape backgrounds and reuse palette resources', () => {
  const speech = readFileSync('host/modules/ui/components/bubble/speech-balloon.ts', 'utf8')
  const multirow = readFileSync('host/modules/ui/components/bubble/multirow-balloon.ts', 'utf8')

  assert.match(speech, /let bubbleSkinCache: Map<.*> \| null = null/)
  assert.match(speech, /let textStyleCache: Map<.*> \| null = null/)
  assert.match(speech, /if \(!bubbleSkinCache\) bubbleSkinCache = new Map\(\)/)
  assert.match(speech, /if \(!textStyleCache\) textStyleCache = new Map\(\)/)
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
      assert.doesNotMatch(block, /\bnew\b/, `${file} should not allocate objects in onTimeChanged`)
      assert.doesNotMatch(block, /(?:=|return|,\s*)\s*\{/, `${file} should not create object literals in onTimeChanged`)
      assert.doesNotMatch(block, /(?:=|return|,\s*)\s*\[/, `${file} should not create array literals in onTimeChanged`)
      assert.doesNotMatch(
        block,
        /\.\s*(?:map|filter|reduce)\s*\(/,
        `${file} should not allocate arrays in onTimeChanged`,
      )
      assert.doesNotMatch(block, /\.\.\./, `${file} should not use spread in onTimeChanged`)
      assert.doesNotMatch(block, /\bnew\s+(Skin|Style)\b/, `${file} should not allocate Skin/Style in onTimeChanged`)
      assert.doesNotMatch(block, /\.string\s*=/, `${file} should not update text in onTimeChanged`)
    }
  }
})
