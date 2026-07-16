import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { FACE_ASSET_EMOTIONS } from '../editor/face-assets.mjs'

const [html, source, styles] = await Promise.all([
  readFile(new URL('./index.html', import.meta.url), 'utf8'),
  readFile(new URL('./face-editor.mjs', import.meta.url), 'utf8'),
  readFile(new URL('./face-editor.css', import.meta.url), 'utf8'),
])

test('Shape face editor exposes geometry, preview, persistence, and editor handoff controls', () => {
  for (const id of [
    'face-canvas',
    'face-frame',
    'face-name',
    'face-emotion',
    'primary-color',
    'secondary-color',
    'mouth-open',
    'canvas-left',
    'canvas-top',
    'canvas-width',
    'canvas-height',
    'left-eye-x',
    'left-eye-y',
    'left-eye-radius',
    'left-eyelid-width',
    'left-eyelid-height',
    'right-eye-x',
    'right-eye-y',
    'right-eye-radius',
    'right-eyelid-width',
    'right-eyelid-height',
    'mouth-x',
    'mouth-y',
    'mouth-min-width',
    'mouth-max-width',
    'load-face',
    'reset-face',
    'download-face',
    'send-to-editor',
    'shape-code-preview',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`))
  }
  assert.match(source, /stackchan-face-asset-staging/)
  assert.match(source, /shapeFaceDefinition/)
  assert.match(source, /pointerdown/)
  assert.match(source, /ArrowLeft/)
  assert.match(source, /parseFaceAsset\(await file\.text\(\)\)/)
  assert.match(source, /\.stackchan-face\.json/)
  assert.match(source, /eyelidWidth\.value = String\(diameter\)/)
  assert.match(html, /瞳全体を覆う大きさ/)
  assert.match(styles, /\.shape-part/)
  assert.match(styles, /aspect-ratio: 4 \/ 3/)
  const emotionOptions = [...html.matchAll(/<option value="([A-Z]+)">/g)].map((match) => match[1])
  assert.deepEqual(emotionOptions, FACE_ASSET_EMOTIONS)
})
