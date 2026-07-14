import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const notesSource = readFileSync('host/modules/ui/components/effects/music-notes.ts', 'utf8')
const faceSource = readFileSync('host/modules/ui/components/face/behaviors/face.ts', 'utf8')
const modSource = readFileSync('mods/examples/web_radio/mod.ts', 'utf8')

test('RelaxedFace uses only the breath motion', () => {
  const relaxedFace = faceSource.slice(
    faceSource.indexOf('export const RelaxedFace'),
    faceSource.indexOf('export const DogFace'),
  )
  assert.match(relaxedFace, /createBreathMotion/)
  assert.doesNotMatch(relaxedFace, /createBlinkMotion|createSaccadeMotion/)
})

test('MusicNotes uses two fixed emoticon sprites without animation timers', () => {
  assert.match(notesSource, /new Texture\('emoticon\.png'\)/)
  assert.match(notesSource, /const MUSIC_ROW = 4/)
  assert.match(notesSource, /new StaticNote\(\{ left: LEFT_NOTE_X/)
  assert.match(notesSource, /new StaticNote\(\{ right: RIGHT_NOTE_X/)
  assert.match(notesSource, /const LEFT_NOTE_X = 12/)
  assert.match(notesSource, /const RIGHT_NOTE_X = 12/)
  assert.doesNotMatch(notesSource, /onTimeChanged|\.start\(\)|\.stop\(\)|interval:/)
})

test('WebRadio keeps the configured face and confines notes to the side regions', () => {
  assert.doesNotMatch(modSource, /\.setFace\(|RelaxedFace/)
  assert.match(modSource, /const QUIET_VOLUME = 0\.05/)
  assert.match(modSource, /setFaceMotionEnabled\?\.\(false\)/)
  assert.match(notesSource, /const LEFT_NOTE_Y = 72/)
  assert.match(notesSource, /const RIGHT_NOTE_Y = 104/)
  assert.doesNotMatch(notesSource, /particle|coordinates|moveBy/)
})
