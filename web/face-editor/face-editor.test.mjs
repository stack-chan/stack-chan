import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { FACE_ASSET_EMOTIONS } from '../editor/face-assets.mjs'

const [html, source, storageSource, styles] = await Promise.all([
  readFile(new URL('./index.html', import.meta.url), 'utf8'),
  readFile(new URL('./face-editor.mjs', import.meta.url), 'utf8'),
  readFile(new URL('./face-editor-storage.mjs', import.meta.url), 'utf8'),
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
    'left-eye-shape',
    'left-eye-x',
    'left-eye-y',
    'left-eye-radius',
    'left-eye-width',
    'left-eye-height',
    'left-eye-r',
    'left-eyelid-width',
    'left-eyelid-height',
    'right-eye-shape',
    'right-eye-x',
    'right-eye-y',
    'right-eye-radius',
    'right-eye-width',
    'right-eye-height',
    'right-eye-r',
    'right-eyelid-width',
    'right-eyelid-height',
    'mouth-visible',
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
  assert.match(storageSource, /stackchan-face-asset-staging/)
  assert.match(storageSource, /stackchan-face-editor-draft-v1/)
  assert.match(source, /loadFaceEditContext/)
  assert.match(source, /loadFaceDraft/)
  assert.match(source, /saveFaceDraft/)
  assert.match(source, /stageFaceTransfer\(asset, activeEditContext\)/)
  assert.match(html, /id="send-to-editor"[\s\S]*?<span>MODで使う<\/span>/)
  assert.match(source, /elements\.sendToEditorLabel\.textContent = t\('変更を反映'\)/)
  assert.match(source, /shapeFaceDefinition/)
  assert.match(source, /pointerdown/)
  assert.match(source, /ArrowLeft/)
  assert.match(source, /parseFaceAsset\(await file\.text\(\)\)/)
  assert.match(source, /\.stackchan-face\.json/)
  assert.match(source, /group\.eyelidWidth\.value = String\(width\)/)
  assert.match(source, /syncEyeControls/)
  assert.match(source, /elements\.mouthPart\.toggleAttribute\('hidden', !shape\.mouth\.visible\)/)
  assert.match(source, /mouthPreview\.removeAttribute\('rx'\)/)
  assert.doesNotMatch(source, /mouthPreview\.setAttribute\('rx'/)
  assert.match(html, /<rect id="left-eye-iris"/)
  assert.match(html, /id="left-eye-shape"[\s\S]*?value="circle"[\s\S]*?value="roundRect"/)
  assert.match(html, /id="mouth-visible"[^>]*checked/)
  assert.match(html, /id="mouth-open"[^>]*value="0"/)
  assert.match(html, /id="mouth-open-output"[\s\S]*?>0\.00</)
  assert.match(source, /applyAsset\(createFaceAsset\(\)\)/)
  assert.doesNotMatch(source, /createFaceAsset\(\{\s*mouth:\s*0\.2\s*\}\)/)
  assert.match(html, /瞳全体を覆う大きさ/)
  assert.match(html, /まぶた幅（自動）/)
  for (const id of ['left-eyelid-width', 'left-eyelid-height', 'right-eyelid-width', 'right-eyelid-height']) {
    assert.match(html, new RegExp(`id="${id}"[\\s\\S]*?readonly`))
  }
  assert.match(styles, /\.shape-part/)
  assert.match(styles, /aspect-ratio: 4 \/ 3/)
  assert.match(styles, /input\[readonly\]/)
  assert.match(styles, /\.toggle-control/)
  assert.match(styles, /#download-face span\s*{\s*display: none;/)
  assert.doesNotMatch(styles, /button:not\(\.icon-button\) span/)
  const emotionOptions = [...html.matchAll(/<option value="([A-Z]+)">/g)].map((match) => match[1])
  assert.deepEqual(emotionOptions, FACE_ASSET_EMOTIONS)
})
