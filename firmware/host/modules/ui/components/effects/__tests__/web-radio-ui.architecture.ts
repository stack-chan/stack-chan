import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const notesSource = readFileSync('host/modules/ui/components/effects/music-notes.ts', 'utf8')
const faceSource = readFileSync('host/modules/ui/components/face/behaviors/face.ts', 'utf8')

test('RelaxedFace uses only the breath motion', () => {
  const relaxedFace = faceSource.slice(
    faceSource.indexOf('export const RelaxedFace'),
    faceSource.indexOf('export const DogFace'),
  )
  assert.match(relaxedFace, /createBreathMotion/)
  assert.doesNotMatch(relaxedFace, /createBlinkMotion|createSaccadeMotion/)
})

test('MusicNotes time updates do not allocate or modify Piu coordinates', () => {
  const timeChanged = notesSource.slice(notesSource.indexOf('onTimeChanged'), notesSource.indexOf('onDraw'))
  assert.doesNotMatch(timeChanged, /\bnew\s|\.coordinates|\.moveBy|new Skin|new Texture/)
  assert.match(timeChanged, /port\.invalidate\(\)/)
})

test('MusicNotes starts and stops with display lifecycle', () => {
  assert.match(notesSource, /onDisplaying[\s\S]*port\.start\(\)/)
  assert.match(notesSource, /onUndisplaying[\s\S]*port\.stop\(\)/)
})
