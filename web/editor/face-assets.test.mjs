import assert from 'node:assert/strict'
import test from 'node:test'
import { applyFaceAssetToSource, createFaceAsset, parseFaceAsset } from './face-assets.mjs'

test('face asset round-trips with normalized colors and mouth range', () => {
  const asset = createFaceAsset({ name: '笑顔', emotion: 'HAPPY', primary: '#ABCDEF', mouth: 2 })
  const restored = parseFaceAsset(JSON.stringify(asset))
  assert.equal(restored.colors.primary, '#abcdef')
  assert.equal(restored.mouth, 1)
})

test('face asset is applied through the public face capability', () => {
  const source = 'export async function onContextCreated(robot) {\n  const runtime = createVisualRuntime(robot)\n}\n'
  const result = applyFaceAssetToSource(source, createFaceAsset({ emotion: 'SAD', secondary: '#010203' }))
  assert.match(result, /Emotion\.SAD/)
  assert.match(result, /setColor\('secondary', 1, 2, 3\)/)
  assert.match(result, /import \{ Emotion \} from 'face-state'/)
})

test('external face assets reject fields and values outside the published schema', () => {
  const valid = createFaceAsset({ name: '検証', emotion: 'HAPPY' })
  for (const invalid of [
    { ...valid, extra: true },
    { ...valid, name: '' },
    { ...valid, emotion: 'UNKNOWN' },
    { ...valid, colors: { ...valid.colors, primary: 'red' } },
    { ...valid, mouth: 2 },
  ]) {
    assert.throws(() => parseFaceAsset(JSON.stringify(invalid)), /顔アセット/)
  }
})
