import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

function extractMethodBlocks(source: string, methodName: string): string[] {
  const blocks: string[] = []
  const pattern = new RegExp(`${methodName}\\([^)]*\\)(?:\\s*:\\s*[^\\{]+)?\\s*\\{`, 'g')
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
  // Tombstone: an earlier DataView-backed FaceState was reverted for GC churn
  // and cross-platform alignment issues.
  const faceState = readFileSync('host/modules/ui/state/face-state.ts', 'utf8')
  assert.doesNotMatch(faceState, /\bDataView\b/)
  assert.doesNotMatch(faceState, /\bArrayBuffer\b/)
})

test('FaceBehavior applies breathing without reassigning coordinates on every tick', () => {
  const source = readFileSync('host/modules/ui/components/face/behaviors/face.ts', 'utf8')
  const blocks = extractMethodBlocks(source, 'onTimeChanged')

  assert.equal(blocks.length, 1, 'FaceBehavior should have one onTimeChanged hot path')
  assert.doesNotMatch(blocks[0], /container\.coordinates\s*=/)
  assert.match(blocks[0], /container\.moveBy\(/)
})

test('FaceView owns face skin palette calculation', () => {
  const faceView = readFileSync('host/modules/ui/views/main/face-view.ts', 'utf8')
  const faceBehavior = readFileSync('host/modules/ui/components/face/behaviors/face.ts', 'utf8')

  assert.match(faceView, /updateFaceSkinPalette\(/)
  assert.doesNotMatch(faceBehavior, /updateFaceSkinPalette/)
  assert.doesNotMatch(faceBehavior, /\bnew\s+Skin\b/)
})

test('Emoticon effects avoid Shape, Skin, and Style allocation', () => {
  const source = readFileSync('host/modules/ui/components/effects/emoticon.ts', 'utf8')

  assert.doesNotMatch(source, /from 'commodetto\/outline'/)
  assert.doesNotMatch(source, /\bnew Shape\b/)
  assert.doesNotMatch(source, /\bnew Skin\b/)
  assert.doesNotMatch(source, /\bnew Style\b/)
})

test('face parts bound their outline caches and avoid allocation in onFaceState', () => {
  const partFiles = [
    'host/modules/ui/components/face/parts/eye.ts',
    'host/modules/ui/components/face/parts/dog/eyebrow.ts',
    'host/modules/ui/components/face/parts/dog/mouth.ts',
    'host/modules/ui/components/face/parts/dog/nose.ts',
  ]

  for (const file of partFiles) {
    const source = readFileSync(file, 'utf8')
    assert.match(source, /\brememberCachedValue\(/, `${file} should bound generated outline caches`)
    if (file.includes('/dog/')) {
      assert.doesNotMatch(source, /coordinates\s*=/, `${file} should not update coordinates`)
    }
    for (const block of extractMethodBlocks(source, 'onFaceState')) {
      assert.doesNotMatch(block, /\bnew\s+(Skin|Outline\.CanvasPath)\b/, `${file} should not allocate in onFaceState`)
      assert.doesNotMatch(block, /Outline\.(?:fill|stroke)\(/, `${file} should not fill/stroke outlines in onFaceState`)
    }
  }
})

test('ImageAvatar animated sprites avoid per-frame allocation in onFaceState', () => {
  const source = readFileSync('host/modules/ui/components/face/parts/image/image-avatar-face.ts', 'utf8')

  for (const block of extractMethodBlocks(source, 'onFaceState')) {
    assert.doesNotMatch(block, /\.\.\./)
    assert.doesNotMatch(block, /\bnew\s+Skin\b/)
  }
})

test('Bubble components avoid Shape backgrounds', () => {
  const multirow = readFileSync('host/modules/ui/components/bubble/multirow-balloon.ts', 'utf8')

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

test('CommonView mutates drawer items incrementally after batch creation', () => {
  const commonView = readFileSync('host/modules/ui/views/main/common-view.ts', 'utf8')

  for (const methodName of ['addDrawerButton', 'removeDrawerButton', 'setDrawerButtonState']) {
    const blocks = extractMethodBlocks(commonView, methodName)
    assert.equal(blocks.length, 1, `CommonView should define one ${methodName}`)
    assert.doesNotMatch(blocks[0], /replaceDrawer\(/, `${methodName} should not rebuild the Drawer`)
  }
})
