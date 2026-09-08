import { assembleModSource } from './blocks.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addFaceAssetToProject,
  applyFaceAssetToSource,
  createFaceAsset,
  FACE_ASSET_VERSION,
  parseFaceAsset,
  shapeFaceDefinition,
} from './face-assets.mjs'

test('Shape face asset round-trips with geometry and normalized theme values', () => {
  const asset = createFaceAsset({
    name: '笑顔',
    emotion: 'HAPPY',
    primary: '#ABCDEF',
    mouth: 2,
    shape: {
      eyes: { left: { x: 44, y: 38, radius: 11 }, right: { x: 156, y: 40, radius: 9 } },
      mouth: { x: 98, y: 90, minWidth: 36, maxWidth: 104 },
    },
  })
  const restored = parseFaceAsset(JSON.stringify(asset))
  assert.equal(restored.version, FACE_ASSET_VERSION)
  assert.equal(restored.kind, 'shape')
  assert.equal(restored.colors.primary, '#abcdef')
  assert.equal(restored.mouth, 1)
  assert.equal(restored.shape.eyes.left.x, 44)
  assert.equal(restored.shape.eyes.left.shape, 'circle')
  assert.equal(restored.shape.eyes.left.radius, 11)
  assert.equal(restored.shape.eyes.left.eyelidWidth, 22)
  assert.equal(restored.shape.eyes.left.eyelidHeight, 22)
  assert.equal(restored.shape.mouth.visible, true)
  assert.equal(restored.shape.mouth.maxWidth, 104)
})

test('Shape face creation restores defaults for null optional groups', () => {
  const asset = createFaceAsset({ colors: null, canvas: null, shape: null })
  assert.deepEqual(asset.canvas, { left: 60, top: 60, width: 200, height: 120 })
  assert.equal(asset.shape.eyes.left.x, 30)
  assert.equal(asset.shape.eyes.left.shape, 'circle')
  assert.equal(asset.shape.eyes.left.eyelidWidth, 16)
  assert.equal(asset.shape.eyes.left.eyelidHeight, 16)
  assert.equal(asset.shape.mouth.visible, true)
  assert.equal(asset.shape.mouth.maxWidth, 90)
})

test('eyelids stay centered on and large enough to cover their irises', () => {
  const asset = createFaceAsset({
    shape: {
      eyes: {
        left: { x: 1, y: 1, radius: 20, eyelidWidth: 4, eyelidHeight: 6 },
      },
    },
  })
  assert.deepEqual(asset.shape.eyes.left, {
    x: 20,
    y: 20,
    shape: 'circle',
    radius: 20,
    eyelidWidth: 40,
    eyelidHeight: 40,
  })
})

test('round rect irises and hidden mouths round-trip into generated Face source', () => {
  const asset = createFaceAsset({
    mouth: 0.7,
    shape: {
      eyes: {
        left: { shape: 'roundRect', x: 42, y: 38, width: 30, height: 18, r: 5 },
        right: { shape: 'circle', x: 158, y: 40, radius: 10 },
      },
      mouth: { visible: false, x: 100, y: 90 },
    },
  })
  const restored = parseFaceAsset(JSON.stringify(asset))
  assert.deepEqual(restored.shape.eyes.left, {
    x: 42,
    y: 38,
    shape: 'roundRect',
    width: 30,
    height: 18,
    r: 5,
    eyelidWidth: 30,
    eyelidHeight: 18,
  })
  assert.equal(restored.shape.mouth.visible, false)

  const definition = shapeFaceDefinition(restored)
  const data = new Function(definition + '; return _StackchanVisualShapeFace')()
  assert.deepEqual(data.shape.eyes.left, restored.shape.eyes.left)
  assert.doesNotMatch(definition, /new Mouth/)

  const source = assembleModSource('')
  const result = applyFaceAssetToSource(source, restored)
  assert.doesNotMatch(result, /import \{ Mouth \}/)
  assert.equal(data.shape.mouth.visible, false)
})

test('incomplete shape geometry is rejected with a recovery error', () => {
  const value = createFaceAsset()
  delete value.shape.eyes.left.shape
  assert.throws(() => parseFaceAsset(JSON.stringify(value)), /形式または値が不正/)
})

test('Shape face source preserves SDK geometry data', () => {
  const definition = shapeFaceDefinition(
    createFaceAsset({
      canvas: { left: 48, top: 52, width: 220, height: 132 },
      shape: {
        eyes: { left: { x: 42 }, right: { x: 178 } },
        mouth: { x: 110, y: 96 },
      },
    })
  )
  const data = new Function(definition + '; return _StackchanVisualShapeFace')()
  assert.equal(data.shape.eyes.left.x, 42)
  assert.equal(data.shape.eyes.right.x, 178)
  assert.equal(data.shape.mouth.x, 110)
  assert.equal(data.shape.mouth.y, 96)
})

test('face asset replaces the active Face through the public UI capability', () => {
  const source = assembleModSource('')
  const result = applyFaceAssetToSource(
    source,
    createFaceAsset({
      emotion: 'SAD',
      secondary: '#010203',
      shape: { eyes: { left: { x: 45 }, right: { x: 155 } } },
    })
  )
  const calls = []
  const executable = result.replace(/^import .*$/gm, '').replace('export default ', 'return ')
  const app = new Function('defineApp', 'ui', executable)(
    (definition) => definition,
    (context) => context.ui
  )
  app.setup({
    time: { after() {} },
    face: {
      setEmotion: (...args) => calls.push(['emotion', ...args]),
      setColor: (...args) => calls.push(['color', ...args]),
      setMouthOpen: (...args) => calls.push(['mouth', ...args]),
    },
    ui: { setShapeFace: (shape) => calls.push(['shape', shape]) },
  })
  assert.equal(calls[0][1].shape.eyes.left.x, 45)
  assert.deepEqual(calls.slice(1), [
    ['emotion', 'sad'],
    ['color', 'primary', { r: 255, g: 255, b: 255 }],
    ['color', 'secondary', { r: 1, g: 2, b: 3 }],
    ['mouth', 0],
  ])
})

test('external Shape assets reject unknown fields and invalid geometry', () => {
  const valid = createFaceAsset({ name: '検証', emotion: 'HAPPY' })
  for (const invalid of [
    {
      format: 'tech.stackchan.face',
      version: 1,
      name: '廃止した簡易形式',
      emotion: 'HAPPY',
      colors: { primary: '#ffffff', secondary: '#202020' },
      mouth: 0.4,
    },
    { ...valid, extra: true },
    { ...valid, name: '' },
    { ...valid, emotion: 'UNKNOWN' },
    { ...valid, colors: { ...valid.colors, primary: 'red' } },
    { ...valid, mouth: 2 },
    { ...valid, canvas: { ...valid.canvas, left: 300 } },
    {
      ...valid,
      shape: {
        ...valid.shape,
        eyes: { ...valid.shape.eyes, left: { ...valid.shape.eyes.left, x: valid.canvas.width + 1 } },
      },
    },
    {
      ...valid,
      shape: {
        ...valid.shape,
        eyes: {
          ...valid.shape.eyes,
          left: { ...valid.shape.eyes.left, eyelidWidth: valid.shape.eyes.left.radius * 2 - 1 },
        },
      },
    },
    {
      ...valid,
      shape: {
        ...valid.shape,
        eyes: {
          ...valid.shape.eyes,
          left: {
            x: 30,
            y: 33,
            shape: 'roundRect',
            width: 20,
            height: 12,
            r: 7,
            eyelidWidth: 20,
            eyelidHeight: 12,
          },
        },
      },
    },
    {
      ...valid,
      shape: {
        ...valid.shape,
        mouth: { ...valid.shape.mouth, minWidth: 100, maxWidth: 20 },
      },
    },
    {
      ...valid,
      shape: {
        ...valid.shape,
        mouth: { ...valid.shape.mouth, visible: 'yes' },
      },
    },
  ]) {
    assert.throws(() => parseFaceAsset(JSON.stringify(invalid)), /顔アセット|Shape顔/)
  }
})

test('staging a Shape face leaves the current project unchanged until persistence succeeds', () => {
  const current = {
    assets: [],
    settings: { educationalProfile: true, embedAssets: true, faceAsset: null },
  }
  const next = addFaceAssetToProject(current, createFaceAsset({ name: '追加の顔', emotion: 'HAPPY' }))

  assert.deepEqual(current.assets, [])
  assert.equal(current.settings.faceAsset, null)
  assert.notEqual(next.assets, current.assets)
  assert.notEqual(next.settings, current.settings)
  assert.equal(next.settings.faceAsset, 'assets/追加の顔.stackchan-face.json')
  assert.equal(JSON.parse(next.assets[0].data).kind, 'shape')
})

test('editing a staged Shape face replaces its stable asset path even when its name changes', () => {
  const original = addFaceAssetToProject(
    { assets: [], settings: { educationalProfile: true, embedAssets: true, faceAsset: null } },
    createFaceAsset({ name: '元の顔', emotion: 'NEUTRAL' })
  )
  const originalPath = original.settings.faceAsset

  const edited = addFaceAssetToProject(original, createFaceAsset({ name: '変更後の顔', emotion: 'HOT' }), {
    replacePath: originalPath,
  })

  assert.equal(edited.assets.length, 1)
  assert.equal(edited.assets[0].path, originalPath)
  assert.equal(edited.settings.faceAsset, originalPath)
  assert.equal(JSON.parse(edited.assets[0].data).name, '変更後の顔')
  assert.equal(JSON.parse(edited.assets[0].data).emotion, 'HOT')
  assert.throws(
    () =>
      addFaceAssetToProject(original, createFaceAsset({ name: '不明な顔' }), {
        replacePath: 'assets/missing.stackchan-face.json',
      }),
    /更新対象/
  )
})
