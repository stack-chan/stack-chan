import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const notesSource = readFileSync('host/modules/ui/components/effects/music-notes.ts', 'utf8')
const faceSource = readFileSync('host/modules/ui/components/face/behaviors/face.ts', 'utf8')
const statusBarSource = readFileSync('host/modules/ui/components/status-bar/chat-status-bar.ts', 'utf8')
const modSource = readFileSync('mods/examples/web_radio/mod.ts', 'utf8')

test('RelaxedFace uses only the breath motion', () => {
  const relaxedFace = faceSource.slice(
    faceSource.indexOf('export const RelaxedFace'),
    faceSource.indexOf('export const DogFace'),
  )
  assert.match(relaxedFace, /createBreathMotion/)
  assert.doesNotMatch(relaxedFace, /createBlinkMotion|createSaccadeMotion/)
})

test('MusicNotes fades two fixed side sprites while lifting them 30 pixels', () => {
  assert.match(notesSource, /new Texture\('emoticon\.png'\)/)
  assert.match(notesSource, /const MUSIC_ROW = 4/)
  assert.match(notesSource, /const RISE_PIXELS = 30/)
  assert.match(notesSource, /const ANIMATION_INTERVAL_MS = 150/)
  assert.match(notesSource, /new FloatingNote\(\{ left: LEFT_NOTE_X/)
  assert.match(notesSource, /new FloatingNote\(\{ right: RIGHT_NOTE_X/)
  assert.match(notesSource, /const LEFT_NOTE_X = 12/)
  assert.match(notesSource, /const RIGHT_NOTE_X = 12/)
  assert.match(notesSource, /const rise = Math\.round\(RISE_PIXELS \* progress \* \(2 - progress\)\)/)
  assert.match(notesSource, /const alpha = Math\.round\(255 \* \(1 - progress\)\)/)
  const timeChanged = notesSource.slice(notesSource.indexOf('onTimeChanged'), notesSource.indexOf('onDraw'))
  assert.match(timeChanged, /port\.invalidate\(\)/)
  assert.match(timeChanged, /wasVisible \|\| this\.#elapsed < FADE_DURATION_MS/)
  assert.doesNotMatch(timeChanged, /\bnew\s|\.coordinates|\.moveBy|new Skin|new Texture/)
})

test('WebRadio pauses periodic face motion and confines notes to the side regions while playing', () => {
  assert.doesNotMatch(modSource, /\.setFace\(|RelaxedFace/)
  assert.match(modSource, /const QUIET_VOLUME = 0\.05/)
  assert.match(modSource, /setFaceMotionEnabled\?\.\(false\)/)
  assert.match(modSource, /setFaceMotionEnabled\?\.\(true\)/)
  assert.match(notesSource, /const LEFT_NOTE_Y = 72/)
  assert.match(notesSource, /const RIGHT_NOTE_Y = 104/)
  assert.doesNotMatch(notesSource, /particle|coordinates|moveBy/)
})

test('WebRadio drawer offers stop, SomaFM stations, and a direct non-Soma MP3 station', () => {
  assert.match(modSource, /kind: 'choice'/)
  assert.match(modSource, /label: 'ラジオ停止'/)
  assert.match(modSource, /label: 'Groove Salad'/)
  assert.match(modSource, /label: 'Radio Paradise'/)
  assert.match(modSource, /http:\/\/ice2\.somafm\.com\/groovesalad-128-mp3/)
  assert.match(modSource, /http:\/\/stream-tx1\.radioparadise\.com\/mp3-128/)
})

test('WebRadio reuses the AppBar connection indicator without impersonating ChatService state', () => {
  assert.match(modSource, /onConnectionIndicator/)
  assert.match(modSource, /state === 'connecting'/)
  assert.match(modSource, /state === 'buffering'/)
  assert.match(modSource, /state === 'stalled'/)
  assert.match(modSource, /state === 'retrying'/)
  assert.doesNotMatch(modSource, /onChatState/)
  assert.match(statusBarSource, /onConnectionIndicator/)
  assert.match(statusBarSource, /ChatStatusBarState\.CONNECTING \|\| this\.#connectionPending/)
})
