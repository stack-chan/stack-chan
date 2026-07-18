import assert from 'node:assert/strict'
import { test } from 'node:test'

import { loadBlocklyMessages } from './blockly-locale.mjs'

test('Blockly locale loader keeps the built-in English messages', async () => {
  await assert.doesNotReject(loadBlocklyMessages('en', null))
})
