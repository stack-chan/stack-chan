import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const notesSource = readFileSync('host/modules/ui/components/effects/music-notes.ts', 'utf8')

test('MusicNotes animation hot path does not allocate or trigger layout', () => {
  const start = notesSource.indexOf('onTimeChanged')
  const end = notesSource.indexOf('onDraw', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  assert.doesNotMatch(notesSource.slice(start, end), /\bnew\s|\.coordinates|\.moveBy/)
})
