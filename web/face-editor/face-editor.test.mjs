import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { FACE_ASSET_EMOTIONS } from '../editor/face-assets.mjs'

const [html, source, styles] = await Promise.all([
  readFile(new URL('./index.html', import.meta.url), 'utf8'),
  readFile(new URL('./face-editor.mjs', import.meta.url), 'utf8'),
  readFile(new URL('./face-editor.css', import.meta.url), 'utf8'),
])

test('face editor exposes preview, asset controls, download, and editor handoff', () => {
  for (const id of [
    'face-canvas',
    'face-name',
    'face-emotion',
    'primary-color',
    'secondary-color',
    'mouth-open',
    'download-face',
    'send-to-editor',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`))
  }
  assert.match(source, /stackchan-face-asset-staging/)
  assert.match(source, /\.stackchan-face\.json/)
  const emotionOptions = [...html.matchAll(/<option value="([A-Z]+)">/g)].map((match) => match[1])
  assert.deepEqual(emotionOptions, FACE_ASSET_EMOTIONS)
  for (const emotion of FACE_ASSET_EMOTIONS.slice(1)) {
    assert.match(styles, new RegExp(`data-emotion='${emotion}'`))
  }
})
