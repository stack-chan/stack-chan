import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const composeSource = readFileSync('host/app/compose.ts', 'utf8')

test('main UI display list capacity is independent of the startup path', () => {
  assert.match(composeSource, /const DEFAULT_UI_DISPLAY_LIST_LENGTH = 4096/)
  assert.match(composeSource, /displayListLength: options\.displayListLength \?\? DEFAULT_UI_DISPLAY_LIST_LENGTH/)
  assert.doesNotMatch(composeSource, /displayListLength = 2048/)
})
